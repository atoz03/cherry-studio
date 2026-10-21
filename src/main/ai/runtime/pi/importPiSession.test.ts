import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'

import { importPiSession } from './importPiSession'
import { piSessionDirectory } from './piSessionFiles'

let root: string
let cwd: string

describe('importPiSession', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-pi-import-')))
    cwd = path.join(root, 'project')
    mkdirSync(cwd)
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      key === 'external.pi.sessions' ? path.join(root, 'store') : getPath(key, filename)
    )
    const file = path.join(piSessionDirectory(cwd), '2026-10-01T00-00-00-000Z_pi-1.jsonl')
    mkdirSync(path.dirname(file), { recursive: true })
    const records = [
      { type: 'session', version: 3, id: 'pi-1', cwd },
      { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'fix the build' } },
      {
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
      }
    ]
    writeFileSync(file, records.map((record) => JSON.stringify(record) + '\n').join(''))

    for (const [id, type] of [
      ['pi-agent', 'pi'],
      ['claude-agent', 'claude-code']
    ] as const) {
      dbh.db.insert(agentTable).values({ id, type, name: id, instructions: '', model: null, orderKey: id }).run()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  const importInto = (agentId: string) => importPiSession({ agentId, piSessionId: 'pi-1', cwd, name: 'fix the build' })

  it('opens the pi session in its own folder with its history, resuming the same pi session', async () => {
    const sessionId = await importInto('pi-agent')

    const session = agentSessionService.getById(sessionId)
    expect(session).toMatchObject({ agentId: 'pi-agent', name: 'fix the build', workspace: { path: cwd } })
    expect(agentSessionMessageService.listSessionRowsTx(dbh.db, sessionId).map((row) => row.role)).toEqual([
      'user',
      'assistant'
    ])
    expect(agentSessionMessageService.getLastRuntimeResumeToken(sessionId)).toBe('pi-1')
  })

  it('reopens the session that already holds the pi session instead of duplicating it', async () => {
    const first = await importInto('pi-agent')

    await expect(importInto('pi-agent')).resolves.toBe(first)
    expect(agentSessionMessageService.listSessionRowsTx(dbh.db, first)).toHaveLength(2)
  })

  it('refuses agents that are not Pi agents, and pi sessions that do not exist', async () => {
    await expect(importInto('claude-agent')).rejects.toThrow()
    await expect(importPiSession({ agentId: 'pi-agent', piSessionId: 'missing', cwd, name: 'x' })).rejects.toThrow()
  })
})
