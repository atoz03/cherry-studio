import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { wrapSteerReminder } from '@main/ai/steerReminder'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { t } from '@main/i18n'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import { PI_BUILTIN_TOOL_NAMES } from '@shared/ai/piBuiltinTools'
import { PI_DEFAULT_MODEL_ID, PI_PROVIDER_ID } from '@shared/data/presets/pi'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { AsyncEventQueue } from '../AsyncEventQueue'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput
} from '../types'
import { PiForkCheckpointSchema } from './forkCheckpoint'
import { resolvePiLaunch } from './piCli'
import {
  buildPiDialogQuestion,
  buildPiDialogResponse,
  type PiDialogLabels,
  type PiDialogRequest,
  parsePiDialogRequest
} from './piExtensionUi'
import { markPiSessionSynced, syncPiSessionHistory } from './piHistorySync'
import { PiRpcClient, type PiRpcRecord } from './piRpcClient'
import { adoptLegacyPiSession, piSessionFileSize, readPiSessionTail } from './piSessionFiles'
import { type PiContentEvent, PI_TRANSPORT, PiStreamAdapter } from './piStreamAdapter'

const logger = loggerService.withContext('PiRuntimeConnection')

const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

interface PiModelSelection {
  provider: string
  modelId: string
}

/** A Pi-provider model names pi's `provider/id`; the default model or any other provider leaves the choice to pi. */
export function resolvePiModelSelection(uniqueModelId: UniqueModelId): PiModelSelection | undefined {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  if (providerId !== PI_PROVIDER_ID || modelId === PI_DEFAULT_MODEL_ID) return undefined
  const separator = modelId.indexOf('/')
  return separator > 0 ? { provider: modelId.slice(0, separator), modelId: modelId.slice(separator + 1) } : undefined
}

/** Agent settings pi starts with. Disabled names other than pi built-ins (e.g. from an older runtime) are dropped. */
function piSpawnOptions(agentId: string) {
  const agent = agentService.getAgent(agentId)
  if (!agent) return undefined
  return {
    excludedTools: (agent.disabledTools ?? []).filter((name) => PI_BUILTIN_TOOL_NAMES.has(name)).sort(),
    envVars: agent.configuration?.env_vars ?? {}
  }
}

/** Facts fixed when pi starts; a change makes the host rebuild the connection. */
function spawnSignature(agentId: string, modelId: UniqueModelId): string | undefined {
  const options = piSpawnOptions(agentId)
  return options && JSON.stringify([resolvePiModelSelection(modelId) ?? null, options])
}

interface PiStateData {
  sessionFile?: string
  steeringMode?: string
  model?: { provider?: string; id?: string }
}

interface PendingDialog {
  client: PiRpcClient
  request: PiDialogRequest
}

/**
 * One Cherry agent session served by the user's `pi --mode rpc`. pi starts on the first message and
 * keeps running until the host closes the connection; the session file is the user's own pi session,
 * so turns added from a terminal are imported before Cherry continues it.
 */
export class PiRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly adapter = new PiStreamAdapter({ enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }) })
  private readonly piSessionId: string
  private readonly signature: string | undefined
  private client?: PiRpcClient
  private starting?: Promise<PiRpcClient>
  private sessionFile?: string
  /** File size after pi's last settled run; any other size means something else wrote to it. */
  private knownSize?: number
  private steeringMode = 'one-at-a-time'
  private runActive = false
  private autonomousRun = false
  private manualCompactInFlight = false
  private resumeTokenEmitted: boolean
  private lastStopReason?: string
  private lastAgentError?: string
  private readonly pendingSteers: AgentRuntimeUserInput[] = []
  private readonly pendingDialogs = new Map<string, PendingDialog>()
  private commands?: AgentSessionSlashCommand[]
  private closed = false

  readonly events = this.eventQueue

  constructor(
    private readonly input: AgentRuntimeConnectInput,
    private readonly workspacePath: string
  ) {
    this.piSessionId = input.resumeToken ?? input.nativeSessionId ?? input.sessionId
    this.resumeTokenEmitted = input.resumeToken === this.piSessionId
    this.signature = spawnSignature(input.agentId, input.modelId)
  }

  /** Cheap by design: opening a session view connects, but only a message starts pi. */
  async start(): Promise<this> {
    await adoptLegacyPiSession(this.workspacePath, this.piSessionId)
    await syncPiSessionHistory({
      sessionId: this.input.sessionId,
      cwd: this.workspacePath,
      piSessionId: this.piSessionId
    })
    return this
  }

  send(input: AgentRuntimeUserInput): void {
    void this.sendTurn(input)
  }

  private async sendTurn(input: AgentRuntimeUserInput): Promise<void> {
    const raw = buildAgentUserContent(input.message)
    const manualCompact = input.systemReminder ? undefined : parseManualCompactCommand(raw)
    if (manualCompact) this.manualCompactInFlight = true
    else this.runActive = true
    try {
      const client = await this.ensureClient()
      this.emitResumeToken()
      if (manualCompact) {
        await client.request({ type: 'compact', customInstructions: manualCompact.instructions || undefined })
        // compaction_end normally settles the turn first; this covers a compact pi skipped.
        this.completeManualCompact()
        return
      }
      const message = input.systemReminder ? wrapSteerReminder(raw) : raw
      // A run an extension started on its own is still streaming; pi rejects a bare prompt then.
      const result = await client.request<{ disposition?: string }>({
        type: 'prompt',
        message,
        ...(this.autonomousRun ? { streamingBehavior: 'followUp' } : {})
      })
      // An extension command consumed the prompt without starting a run.
      if (result?.disposition === 'handled') await this.finishRun()
    } catch (error) {
      if (this.closed) return
      if (!this.runActive && !this.manualCompactInFlight) return
      this.runActive = false
      this.manualCompactInFlight = false
      logger.error('pi prompt failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    }
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    const client = this.client
    if (!client?.running || !this.runActive) return false
    this.pendingSteers.push(input)
    client
      .request({ type: 'steer', message: wrapSteerReminder(buildAgentUserContent(input.message)) })
      .catch((error) => {
        const index = this.pendingSteers.indexOf(input)
        if (index !== -1) this.pendingSteers.splice(index, 1)
        if (this.closed) return
        logger.error('pi steer failed', error as Error)
        this.eventQueue.push({ type: 'error', error })
      })
    return true
  }

  async reconcile(input: { modelId: UniqueModelId }): Promise<AgentRuntimeReconcileResult> {
    const session = agentSessionService.getById(this.input.sessionId)
    if (!session || session.agentId !== this.input.agentId || session.workspace?.path !== this.workspacePath) {
      return session ? 'rebuild' : 'invalid'
    }
    const signature = spawnSignature(this.input.agentId, input.modelId)
    if (!signature) return 'invalid'
    return signature === this.signature ? 'current' : 'rebuild'
  }

  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    const client = this.client
    if (!client?.running) return null
    const stats = await client.request<{
      contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null }
    }>({ type: 'get_session_stats' })
    const usage = stats?.contextUsage
    if (!usage || usage.tokens == null) return null
    const percentage =
      usage.percent ?? (usage.contextWindow > 0 ? Math.min(100, (usage.tokens / usage.contextWindow) * 100) : 0)
    return {
      categories: [],
      totalTokens: usage.tokens,
      maxTokens: usage.contextWindow,
      percentage,
      model: parseUniqueModelId(this.input.modelId).modelId
    }
  }

  async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    return this.commands ?? null
  }

  close(): Promise<void> {
    this.closed = true
    return (this.closePromise ??= this.finishClose())
  }

  closeForEdit(): Promise<void> {
    return this.close()
  }

  private closePromise?: Promise<void>

  private async finishClose(): Promise<void> {
    toolApprovalRegistry.abort(this.input.sessionId, 'pi-session-closed')
    try {
      const client = this.client ?? (await this.starting?.catch(() => undefined))
      if (client?.running && this.runActive) await withTimeout(client.request({ type: 'abort' }), 5000)
      await client?.close()
    } catch (error) {
      logger.warn('pi did not stop cleanly', { error })
    } finally {
      this.eventQueue.close()
    }
  }

  private async ensureClient(): Promise<PiRpcClient> {
    const current = this.client
    if (current?.running) {
      if (!(await this.changedElsewhere())) return current
      // The user continued this session in a terminal: show those turns and restart pi on them.
      this.client = undefined
      await current.close()
      await syncPiSessionHistory({
        sessionId: this.input.sessionId,
        cwd: this.workspacePath,
        piSessionId: this.piSessionId
      })
    }
    this.starting ??= this.spawn().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async changedElsewhere(): Promise<boolean> {
    if (!this.sessionFile || this.knownSize === undefined) return false
    return (await piSessionFileSize(this.sessionFile)) !== this.knownSize
  }

  private async spawn(): Promise<PiRpcClient> {
    const { command, env } = await resolvePiLaunch()
    const { excludedTools, envVars } = piSpawnOptions(this.input.agentId) ?? { excludedTools: [], envVars: {} }
    const client: PiRpcClient = new PiRpcClient({
      command,
      args: [
        '--mode',
        'rpc',
        '--session-id',
        this.piSessionId,
        ...(excludedTools.length > 0 ? ['--exclude-tools', excludedTools.join(',')] : [])
      ],
      cwd: this.workspacePath,
      env: { ...env, ...envVars },
      onRecord: (record) => {
        if (this.client === client) this.handleRecord(record)
        else if (record.type === 'extension_ui_request') this.handleUiRequest(client, record)
      },
      onExit: (error) => this.handleExit(client, error)
    })
    try {
      let state = await client.request<PiStateData>({ type: 'get_state' })
      const model = resolvePiModelSelection(this.input.modelId)
      if (model && (state.model?.provider !== model.provider || state.model?.id !== model.modelId)) {
        await client.request({ type: 'set_model', provider: model.provider, modelId: model.modelId })
        state = await client.request<PiStateData>({ type: 'get_state' })
      }
      this.steeringMode = state.steeringMode ?? 'one-at-a-time'
      this.sessionFile = state.sessionFile
      this.knownSize = state.sessionFile ? await piSessionFileSize(state.sessionFile) : undefined
      this.client = client
      void this.refreshCommands(client)
      return client
    } catch (error) {
      await client.close()
      throw error
    }
  }

  private async refreshCommands(client: PiRpcClient): Promise<void> {
    try {
      const { commands } = await client.request<{ commands: Array<{ name: string; description?: string }> }>({
        type: 'get_commands'
      })
      this.commands = [
        { name: 'compact', description: 'Compact conversation with optional focus instructions', argumentHint: '' },
        ...commands.map((command) => ({ name: command.name, description: command.description ?? '', argumentHint: '' }))
      ]
      if (!this.closed) this.eventQueue.push({ type: 'supported-commands', commands: this.commands })
    } catch (error) {
      logger.warn('Could not read pi commands', { error })
    }
  }

  private handleExit(client: PiRpcClient, error: Error | undefined): void {
    for (const [approvalId, dialog] of this.pendingDialogs) {
      if (dialog.client === client) toolApprovalRegistry.dispatch(approvalId, { approved: false, reason: 'pi exited' })
    }
    if (client !== this.client) return
    this.client = undefined
    if (this.closed || (!this.runActive && !this.manualCompactInFlight)) return
    this.runActive = false
    this.manualCompactInFlight = false
    this.pendingSteers.length = 0
    this.eventQueue.push({ type: 'error', error: error ?? new Error('pi exited during the turn') })
  }

  private handleRecord(record: PiRpcRecord): void {
    if (this.closed) return
    switch (record.type) {
      case 'extension_ui_request':
        this.handleUiRequest(this.client!, record)
        return
      case 'extension_error':
        logger.warn('pi extension failed', {
          extension: record.extensionPath,
          event: record.event,
          error: record.error
        })
        return
      case 'agent_start':
        if (!this.runActive && !this.manualCompactInFlight && !this.autonomousRun) {
          // An extension started this run on its own; the host opens a receive-only turn for it.
          this.autonomousRun = true
          this.eventQueue.push({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
        }
        break
      case 'message_start':
        if ((record.message as { role?: string } | undefined)?.role === 'user' && this.pendingSteers.length > 0) {
          const count = this.steeringMode === 'all' ? this.pendingSteers.length : 1
          this.eventQueue.push({ type: 'steer-boundary', inputs: this.pendingSteers.splice(0, count) })
        }
        break
      case 'turn_end': {
        const stopReason = (record.message as { stopReason?: string } | undefined)?.stopReason
        if (stopReason) this.lastStopReason = stopReason
        break
      }
      case 'agent_end':
        if (record.willRetry) {
          this.lastStopReason = undefined
          this.lastAgentError = undefined
        } else {
          this.lastAgentError = lastErrorMessage(record.messages)
        }
        return
      case 'agent_settled':
        void this.finishRun()
        return
      case 'compaction_start':
        this.eventQueue.push({ type: 'compaction-start', trigger: mapCompactionTrigger(record.reason) })
        return
      case 'compaction_end':
        this.handleCompactionEnd(record)
        return
      case 'auto_retry_start':
        this.eventQueue.push({
          type: 'api-retry',
          retry: {
            attempt: Number(record.attempt) || 1,
            maxRetries: Number(record.maxAttempts) || 1,
            retryDelayMs: Number(record.delayMs) || 0,
            errorStatus: null,
            errorCategory: typeof record.errorMessage === 'string' ? record.errorMessage : 'unknown'
          }
        })
        return
    }
    this.adapter.handleEvent(record as PiContentEvent)
  }

  private async finishRun(): Promise<void> {
    if (this.closed) return
    const autonomous = this.autonomousRun
    if (!this.runActive && !autonomous) return
    this.runActive = false
    this.autonomousRun = false
    const undelivered = this.pendingSteers.splice(0)
    if (undelivered.length > 0) {
      // pi keeps undelivered steers queued; the host re-queues them as the next turn instead.
      await this.client?.request({ type: 'clear_queue' }).catch(() => undefined)
      this.eventQueue.push({ type: 'steer-undelivered', inputs: undelivered })
    }
    const failed = this.lastStopReason === 'error' || this.lastStopReason === 'length'
    const failure = failed
      ? new Error(
          this.lastAgentError ??
            (this.lastStopReason === 'length'
              ? 'Response truncated at the model output limit (stopReason: length).'
              : 'pi agent turn failed')
        )
      : undefined
    this.lastStopReason = undefined
    this.lastAgentError = undefined
    const leafId = await this.recordSettledFile()
    if (this.closed) return
    if (failure) {
      this.eventQueue.push({ type: 'error', error: failure })
    } else {
      const checkpoint = PiForkCheckpointSchema.safeParse({
        runtime: 'pi',
        runtimeSessionId: this.piSessionId,
        leafId
      })
      this.eventQueue.push({
        type: 'turn-complete',
        forkAnchor: checkpoint.success ? { checkpoint: checkpoint.data } : undefined
      })
    }
    if (autonomous) this.eventQueue.push({ type: 'autonomous-turn-state', state: 'finished' })
  }

  /** Advance the sync watermark past pi's own entries and return the new leaf. */
  private async recordSettledFile(): Promise<string | undefined> {
    if (!this.sessionFile) return undefined
    try {
      const { size, leafId } = await readPiSessionTail(this.sessionFile)
      this.knownSize = size
      if (leafId) markPiSessionSynced(this.input.sessionId, { piSessionId: this.piSessionId, leafId })
      return leafId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('Could not read pi session file', { error })
      return undefined
    }
  }

  private handleCompactionEnd(record: PiRpcRecord): void {
    const errorMessage = typeof record.errorMessage === 'string' ? record.errorMessage : undefined
    if (errorMessage || record.aborted) {
      const message = errorMessage ?? 'pi compaction aborted'
      if (this.manualCompactInFlight) {
        this.manualCompactInFlight = false
        this.eventQueue.push({ type: 'error', error: new Error(message) })
      } else {
        this.eventQueue.push({ type: 'compaction-error', error: message })
      }
      return
    }
    const result = record.result as { tokensBefore?: unknown; estimatedTokensAfter?: unknown } | undefined
    const anchor: AgentSessionCompactionAnchorData = {
      status: 'done',
      phase: 'agent-session',
      trigger: mapCompactionTrigger(record.reason),
      completedAt: new Date().toISOString()
    }
    if (typeof result?.tokensBefore === 'number') anchor.preTokens = result.tokensBefore
    if (typeof result?.estimatedTokensAfter === 'number') anchor.postTokens = result.estimatedTokensAfter
    this.eventQueue.push({ type: 'compaction-complete', anchor })
    this.completeManualCompact()
  }

  private completeManualCompact(): void {
    if (this.closed || !this.manualCompactInFlight) return
    this.manualCompactInFlight = false
    void this.recordSettledFile()
    this.eventQueue.push({ type: 'turn-complete' })
  }

  private emitResumeToken(): void {
    if (this.resumeTokenEmitted) return
    this.resumeTokenEmitted = true
    this.eventQueue.push({ type: 'resume-token', token: this.piSessionId })
  }

  /** Plugin dialogs become an AskUserQuestion; status lines, widgets and notifications are ignored. */
  private handleUiRequest(client: PiRpcClient, record: PiRpcRecord): void {
    const request = parsePiDialogRequest(record)
    if (!request) return
    const labels = dialogLabels()
    const interaction = application.get('AgentSessionRuntimeService').getInteractionState(this.input.sessionId)
    if (this.closed || interaction.userResponse === 'unavailable') {
      client.notify(buildPiDialogResponse(request, undefined, labels))
      return
    }
    const question = buildPiDialogQuestion(request, labels)
    const input = { questions: [question] }
    const approvalId = randomUUID()
    const toolCallId = `pi-dialog-${request.id}`
    const presentation = interaction.userResponse === 'stream' ? 'stream' : 'message'
    const providerMetadata = {
      cherry: { transport: PI_TRANSPORT, tool: { type: 'builtin' as const, name: ASK_USER_QUESTION_TOOL } }
    }
    const pending = toolApprovalRegistry.register({
      approvalId,
      sessionId: this.input.sessionId,
      toolCallId,
      toolName: ASK_USER_QUESTION_TOOL,
      originalInput: input,
      presentation,
      resolve: (decision) => {
        this.pendingDialogs.delete(approvalId)
        const answers = decision.updatedInput?.answers as Record<string, string> | undefined
        const answer = decision.approved ? answers?.[question.question] : undefined
        client.notify(buildPiDialogResponse(request, answer, labels))
        if (presentation === 'stream' && !this.closed) {
          this.eventQueue.push({
            type: 'chunk',
            chunk: {
              type: 'tool-output-available',
              toolCallId,
              output: answer ?? null,
              dynamic: true,
              providerExecuted: true,
              providerMetadata
            }
          })
        }
      }
    })
    if (!pending) return
    this.pendingDialogs.set(approvalId, { client, request })
    if (presentation === 'stream') {
      const base = {
        toolCallId,
        toolName: ASK_USER_QUESTION_TOOL,
        dynamic: true,
        providerExecuted: true,
        providerMetadata
      }
      this.eventQueue.push({ type: 'chunk', chunk: { type: 'tool-input-start', ...base } })
      this.eventQueue.push({ type: 'chunk', chunk: { type: 'tool-input-available', ...base, input } })
    }
    this.eventQueue.push({
      type: 'tool-approval-request',
      request: { approvalId, toolCallId, toolName: ASK_USER_QUESTION_TOOL, input, presentation, providerMetadata }
    })
  }
}

function dialogLabels(): PiDialogLabels {
  return {
    yes: t('agent.session.pi.dialog.yes'),
    no: t('agent.session.pi.dialog.no'),
    keep: t('agent.session.pi.dialog.keep')
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, delay(ms, undefined, { ref: false })])
}

/** pi reports `manual` for `/compact`; Cherry's anchor only tells user-initiated from automatic. */
function mapCompactionTrigger(reason: unknown): AgentSessionCompactionTrigger {
  return reason === 'manual' ? 'manual' : 'auto'
}

function parseManualCompactCommand(content: string): { instructions: string } | undefined {
  const trimmed = content.trim()
  if (!/^\/compact(?:\s|$)/.test(trimmed)) return undefined
  return { instructions: trimmed.slice('/compact'.length).trim() }
}

function lastErrorMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; errorMessage?: string }
    if (message.role === 'assistant' && typeof message.errorMessage === 'string') return message.errorMessage
  }
  return undefined
}
