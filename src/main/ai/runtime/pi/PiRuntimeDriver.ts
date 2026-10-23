import { agentSessionService } from '@data/services/AgentSessionService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { resolvePiLaunch } from './piCli'
import { forkPiSession } from './piFork'
import { PiRuntimeConnection } from './PiRuntimeConnection'

/**
 * Pi agents run the user's own `pi` CLI. Its sessions live in the user's pi store, which Cherry
 * shares with their terminal and therefore never sweeps (no `reclaimOrphanSessions`).
 */
export class PiRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi'
  readonly capabilities = ['agent-session'] as const
  readonly fork = forkPiSession

  async validateSession(session: AgentSessionEntity): Promise<void> {
    if (!session.workspace?.path) throw new Error(`pi agent session ${session.id} has no workspace configured`)
    if (!session.agentId) throw new Error(`pi agent session ${session.id} has no agent`)
    await prepareAgentSessionWorkspaceDirectory(session)
    await resolvePiLaunch()
  }

  async listAvailableTools(): Promise<Tool[]> {
    return AGENT_RUNTIME_CAPABILITIES.pi.builtinTools().map((tool) => ({
      id: tool.id,
      name: tool.id,
      origin: 'builtin' as const,
      approval: 'auto' as const
    }))
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const session = agentSessionService.getById(input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`pi agent session ${input.sessionId} has no agent or workspace configured`)
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    return new PiRuntimeConnection(input, workspacePath).start()
  }
}
