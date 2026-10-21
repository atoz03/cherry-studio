/**
 * Bring turns the user added to a pi session outside Cherry (e.g. `pi -r` in a terminal) into
 * Cherry's message history. Each sync appends the active branch past a per-session watermark;
 * Cherry's own runs advance the watermark too, so they are never imported twice.
 */
import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { RuntimeForkAnchorSchema } from '@main/ai/runtime/fork'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import type { PiForkCheckpoint } from './forkCheckpoint'
import {
  findPiSessionFile,
  type PiSessionEntry,
  piMessageRole,
  piMessageText,
  piSessionBranch,
  readPiSession
} from './piSessionFiles'
import { type PiContentEvent, PiStreamAdapter } from './piStreamAdapter'

const SYNC_KEY_PREFIX = 'pi-session-sync:'

interface PiSyncMark {
  piSessionId: string
  leafId: string
}

type ImportedRow = Pick<
  AgentSessionMessageRow,
  'id' | 'role' | 'data' | 'status' | 'modelId' | 'messageSnapshot' | 'runtimeResumeToken' | 'createdAt' | 'updatedAt'
>

function readMark(db: DbOrTx, sessionId: string): PiSyncMark | undefined {
  const row = db
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, `${SYNC_KEY_PREFIX}${sessionId}`))
    .get()
  return row?.value as PiSyncMark | undefined
}

function writeMarkTx(tx: DbOrTx, sessionId: string, mark: PiSyncMark): void {
  tx.insert(appStateTable)
    .values({ key: `${SYNC_KEY_PREFIX}${sessionId}`, value: mark })
    .onConflictDoUpdate({ target: appStateTable.key, set: { value: mark } })
    .run()
}

/** Record that Cherry has seen `leafId`, e.g. after one of its own runs settled. */
export function markPiSessionSynced(sessionId: string, mark: PiSyncMark): void {
  application.get('DbService').withWriteTx((tx) => writeMarkTx(tx, sessionId, mark))
}

/** Drop a session's watermark once its rows are gone. */
export function clearPiSessionSyncTx(tx: DbOrTx, sessionId: string): void {
  tx.delete(appStateTable)
    .where(eq(appStateTable.key, `${SYNC_KEY_PREFIX}${sessionId}`))
    .run()
}

/** Index after which the branch is new to Cherry, or undefined when the history cannot be aligned. */
function syncStart(db: DbOrTx, sessionId: string, piSessionId: string, branch: PiSessionEntry[]): number | undefined {
  const index = new Map(branch.map((entry, position) => [entry.id, position]))
  const mark = readMark(db, sessionId)
  if (mark?.piSessionId === piSessionId && index.has(mark.leafId)) return index.get(mark.leafId)! + 1
  // No usable watermark: fall back to the newest turn Cherry anchored on this branch.
  const rows = agentSessionMessageService.listSessionRowsTx(db, sessionId)
  for (const row of rows.toReversed()) {
    const anchor = RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor)
    const checkpoint = anchor.success ? (anchor.data.checkpoint as Partial<PiForkCheckpoint>) : undefined
    if (checkpoint?.runtime === 'pi' && checkpoint.runtimeSessionId === piSessionId) {
      const position = checkpoint.leafId ? index.get(checkpoint.leafId) : undefined
      if (position !== undefined) return position + 1
    }
  }
  return rows.length === 0 ? 0 : undefined
}

/**
 * Append the pi session's unseen turns to the Cherry session. Returns how many rows were added.
 * A session whose existing rows cannot be aligned with the file is only re-marked, never duplicated.
 */
export async function syncPiSessionHistory(input: {
  sessionId: string
  cwd: string
  piSessionId: string
}): Promise<number> {
  const file = await findPiSessionFile(input.cwd, input.piSessionId)
  if (!file) return 0
  const branch = piSessionBranch((await readPiSession(file)).entries)
  const leaf = branch.at(-1)
  if (!leaf) return 0
  const database = application.get('DbService')
  const start = syncStart(database.getDb(), input.sessionId, input.piSessionId, branch)
  const mark = { piSessionId: input.piSessionId, leafId: leaf.id }
  const rows = start === undefined ? [] : await buildImportedRows(branch.slice(start), input.piSessionId)
  database.withWriteTx((tx) => {
    if (rows.length > 0) {
      agentSessionMessageService.insertForkMessagesTx(tx, input.sessionId, rows)
      agentSessionService.advanceLastActivityAtTx(tx, input.sessionId, rows.at(-1)!.createdAt)
    }
    writeMarkTx(tx, input.sessionId, mark)
  })
  if (rows.length > 0) {
    notifyDataApiDataChange([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'membership',
        routeParams: { sessionId: input.sessionId }
      }
    ])
    agentSessionService.notifyReadModelChange([input.sessionId], 'projection')
  }
  return rows.length
}

interface PiTurn {
  user?: PiSessionEntry
  entries: PiSessionEntry[]
}

function groupTurns(entries: readonly PiSessionEntry[]): PiTurn[] {
  const turns: PiTurn[] = []
  let current: PiTurn | undefined
  for (const entry of entries) {
    if (piMessageRole(entry) === 'user') {
      current = { user: entry, entries: [] }
      turns.push(current)
    } else {
      if (!current) {
        current = { entries: [] }
        turns.push(current)
      }
      current.entries.push(entry)
    }
  }
  return turns
}

function entryTime(entry: PiSessionEntry): number {
  const parsed = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/** Replay a turn's stored messages as the RPC events the live stream would have produced. */
function* turnEvents(entries: readonly PiSessionEntry[]): Generator<PiContentEvent> {
  yield { type: 'agent_start' }
  const toolArgs = new Map<string, unknown>()
  for (const entry of entries) {
    const role = piMessageRole(entry)
    const message = entry.message as Record<string, unknown>
    if (role === 'assistant') {
      yield { type: 'message_start' }
      const content = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []
      for (const [contentIndex, block] of content.entries()) {
        if (block.type === 'text' && typeof block.text === 'string') {
          yield { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex } }
          yield {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', contentIndex, delta: block.text }
          }
          yield { type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex } }
        } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
          yield { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex } }
          yield {
            type: 'message_update',
            assistantMessageEvent: { type: 'thinking_delta', contentIndex, delta: block.thinking }
          }
          yield { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex } }
        } else if (block.type === 'toolCall' && typeof block.id === 'string') {
          toolArgs.set(block.id, block.arguments)
        }
      }
      yield { type: 'turn_end', message }
    } else if (role === 'toolResult' && typeof message.toolCallId === 'string') {
      const toolName = typeof message.toolName === 'string' ? message.toolName : 'tool'
      yield {
        type: 'tool_execution_start',
        toolCallId: message.toolCallId,
        toolName,
        args: toolArgs.get(message.toolCallId)
      }
      yield {
        type: 'tool_execution_end',
        toolCallId: message.toolCallId,
        toolName,
        result: { content: message.content, details: message.details },
        isError: message.isError === true
      }
    }
  }
}

async function assistantParts(entries: readonly PiSessionEntry[]): Promise<CherryMessagePart[]> {
  const chunks: UIMessageChunk[] = [{ type: 'start' }]
  const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
  for (const event of turnEvents(entries)) adapter.handleEvent(event)
  chunks.push({ type: 'finish' })
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  let latest: CherryUIMessage | undefined
  for await (const snapshot of readUIMessageStream<CherryUIMessage>({
    stream,
    message: { id: uuidv7(), role: 'assistant', parts: [] }
  })) {
    latest = snapshot
  }
  return latest?.parts ?? []
}

async function buildImportedRows(entries: readonly PiSessionEntry[], piSessionId: string): Promise<ImportedRow[]> {
  const rows: ImportedRow[] = []
  const row = (role: 'user' | 'assistant', createdAt: number, fields: Partial<ImportedRow>): ImportedRow => ({
    id: uuidv7(),
    role,
    data: { parts: [] },
    status: 'success',
    modelId: null,
    messageSnapshot: null,
    runtimeResumeToken: piSessionId,
    createdAt,
    updatedAt: createdAt,
    ...fields
  })
  for (const turn of groupTurns(entries)) {
    if (turn.user) {
      const text = piMessageText(turn.user)
      rows.push(row('user', entryTime(turn.user), { data: { parts: [{ type: 'text', text }] } }))
    }
    const messages = turn.entries.filter((entry) => ['assistant', 'toolResult'].includes(piMessageRole(entry) ?? ''))
    const last = turn.entries.at(-1)
    if (messages.length === 0 || !last) continue
    const lastAssistant = messages.findLast((entry) => piMessageRole(entry) === 'assistant')
    const stopReason = (lastAssistant?.message as { stopReason?: unknown } | undefined)?.stopReason
    const checkpoint: PiForkCheckpoint = { runtime: 'pi', runtimeSessionId: piSessionId, leafId: last.id }
    rows.push(
      row('assistant', Math.max(entryTime(messages[0]), (rows.at(-1)?.createdAt ?? 0) + 1), {
        status: stopReason === 'error' ? 'error' : 'success',
        data: { parts: await assistantParts(messages), runtimeAnchor: { checkpoint } }
      })
    )
  }
  return rows
}
