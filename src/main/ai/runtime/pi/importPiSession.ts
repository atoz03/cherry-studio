import { and, desc, eq, isNull } from 'drizzle-orm'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceStorageService } from '@main/ai/agents/AgentWorkspaceStorageService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import { syncPiSessionHistory } from './piHistorySync'
import { findPiSessionFile } from './piSessionFiles'

/** The agent's live session that already resumes this pi session, if any. */
function findHoldingSession(agentId: string, piSessionId: string): string | undefined {
  return application
    .get('DbService')
    .getDb()
    .select({ id: agentSessionTable.id })
    .from(agentSessionMessageTable)
    .innerJoin(agentSessionTable, eq(agentSessionTable.id, agentSessionMessageTable.sessionId))
    .where(
      and(
        eq(agentSessionTable.agentId, agentId),
        isNull(agentSessionTable.deletedAt),
        eq(agentSessionMessageTable.runtimeResumeToken, piSessionId)
      )
    )
    .orderBy(desc(agentSessionTable.lastActivityAt))
    .limit(1)
    .get()?.id
}

/**
 * Open a pi CLI session, such as one started in a terminal, as a session of a Pi agent. A session
 * the agent already holds is reused, so two Cherry sessions never drive the same pi session.
 */
export async function importPiSession(input: {
  agentId: string
  piSessionId: string
  cwd: string
  name: string
}): Promise<string> {
  if (agentService.getAgent(input.agentId)?.type !== 'pi') throw DataApiErrorFactory.notFound('Pi agent', input.agentId)
  const existing = findHoldingSession(input.agentId, input.piSessionId)
  if (existing) {
    await syncPiSessionHistory({ sessionId: existing, cwd: input.cwd, piSessionId: input.piSessionId })
    return existing
  }
  if (!(await findPiSessionFile(input.cwd, input.piSessionId))) {
    throw DataApiErrorFactory.notFound('Pi session', input.piSessionId)
  }
  const workspace = agentWorkspaceStorageService.registerWorkspace(input.cwd)
  const session = agentSessionService.create({
    agentId: input.agentId,
    name: input.name,
    workspace: { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: workspace.id }
  })
  await syncPiSessionHistory({ sessionId: session.id, cwd: input.cwd, piSessionId: input.piSessionId })
  return session.id
}
