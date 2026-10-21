import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

import { syncPiSessionHistory } from './piHistorySync'
import { piSessionDirectory } from './piSessionFiles'

const sessionId = 'session-1'
const piSessionId = 'pi-1'
const cwd = '/work/project'
let root: string
let file: string

const at = (second: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, second)).toISOString()

// Shaped like a session the pi CLI writes from a terminal.
const terminalTurn = [
  { type: 'session', version: 3, id: piSessionId, timestamp: at(0), cwd },
  {
    type: 'message',
    id: 'sys',
    parentId: null,
    timestamp: at(0),
    message: { role: 'system', sections: [{ text: 'You are pi' }] }
  },
  { type: 'model_change', id: 'mc', parentId: 'sys', timestamp: at(0), provider: 'anthropic', modelId: 'm' },
  {
    type: 'message',
    id: 'u1',
    parentId: 'mc',
    timestamp: at(1),
    message: { role: 'user', content: [{ type: 'text', text: 'list files' }] }
  },
  {
    type: 'message',
    id: 'a1',
    parentId: 'u1',
    timestamp: at(2),
    message: {
      role: 'assistant',
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'run ls' },
        { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'ls' } }
      ]
    }
  },
  {
    type: 'message',
    id: 'r1',
    parentId: 'a1',
    timestamp: at(3),
    message: { role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'a.txt' }] }
  },
  { type: 'custom', customType: 'cc-thinking-timing', data: { ms: 5 }, id: 'c1', parentId: 'r1', timestamp: at(3) },
  {
    type: 'message',
    id: 'a2',
    parentId: 'c1',
    timestamp: at(4),
    message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'One file: a.txt' }] }
  }
]

function laterTurn(parentId: string, n: number) {
  return [
    {
      type: 'message',
      id: `q${n}`,
      parentId,
      timestamp: at(10 * n),
      message: { role: 'user', content: [{ type: 'text', text: `question ${n}` }] }
    },
    {
      type: 'message',
      id: `ans${n}`,
      parentId: `q${n}`,
      timestamp: at(10 * n + 1),
      message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: `answer ${n}` }] }
    }
  ]
}

const toJsonl = (records: object[]) => records.map((record) => JSON.stringify(record) + '\n').join('')
const sync = () => syncPiSessionHistory({ sessionId, cwd, piSessionId })

describe('syncPiSessionHistory', () => {
  const dbh = setupTestDatabase()

  const rows = () => agentSessionMessageService.listSessionRowsTx(dbh.db, sessionId)
  const transcript = () =>
    rows().map((row) => [
      row.role,
      (row.data.parts ?? [])
        .map((part) => ('text' in part ? part.text : part.type))
        .filter((text) => text !== 'step-start')
    ])

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cherry-pi-history-'))
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      key === 'external.pi.sessions' ? root : getPath(key, filename)
    )
    file = path.join(piSessionDirectory(cwd), `2026-10-01T00-00-00-000Z_${piSessionId}.jsonl`)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, toJsonl(terminalTurn))

    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace-1', name: 'Workspace', path: cwd, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, workspaceId: 'workspace-1', name: 'Session', orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('imports a terminal session as one exchange per user turn, leaving out pi bookkeeping', async () => {
    await expect(sync()).resolves.toBe(2)

    expect(transcript()).toEqual([
      ['user', ['list files']],
      ['assistant', ['run ls', 'dynamic-tool', 'One file: a.txt']]
    ])
    const tool = rows()[1].data.parts?.find((part) => part.type === 'dynamic-tool')
    expect(tool).toMatchObject({ toolName: 'bash', state: 'output-available', input: { command: 'ls' } })
    expect(rows().every((row) => row.runtimeResumeToken === piSessionId)).toBe(true)
  })

  it('imports only the turns added since the previous sync', async () => {
    await sync()
    appendFileSync(file, toJsonl(laterTurn('a2', 2)))

    await expect(sync()).resolves.toBe(2)
    await expect(sync()).resolves.toBe(0)

    expect(transcript().slice(2)).toEqual([
      ['user', ['question 2']],
      ['assistant', ['answer 2']]
    ])
  })

  it('does not re-import a turn Cherry ran itself when no sync has happened yet', async () => {
    agentSessionMessageService.insertForkMessagesTx(dbh.db, sessionId, [
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
        role: 'assistant',
        data: {
          parts: [{ type: 'text', text: 'from Cherry' }],
          runtimeAnchor: { checkpoint: { runtime: 'pi', runtimeSessionId: piSessionId, leafId: 'a2' } }
        },
        status: 'success',
        modelId: null,
        messageSnapshot: null,
        runtimeResumeToken: piSessionId,
        createdAt: 1,
        updatedAt: 1
      }
    ])
    appendFileSync(file, toJsonl(laterTurn('a2', 2)))

    await expect(sync()).resolves.toBe(2)

    expect(transcript()).toEqual([
      ['assistant', ['from Cherry']],
      ['user', ['question 2']],
      ['assistant', ['answer 2']]
    ])
  })

  it('leaves a history it cannot line up untouched but picks up later terminal turns', async () => {
    agentSessionMessageService.insertForkMessagesTx(dbh.db, sessionId, [
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'older chat' }] },
        status: 'success',
        modelId: null,
        messageSnapshot: null,
        runtimeResumeToken: null,
        createdAt: 1,
        updatedAt: 1
      }
    ])

    await expect(sync()).resolves.toBe(0)
    appendFileSync(file, toJsonl(laterTurn('a2', 2)))
    await expect(sync()).resolves.toBe(2)

    expect(transcript()).toEqual([
      ['user', ['older chat']],
      ['user', ['question 2']],
      ['assistant', ['answer 2']]
    ])
  })

  it('marks a turn that ended in a model error as failed', async () => {
    appendFileSync(
      file,
      toJsonl([
        ...laterTurn('a2', 2).slice(0, 1),
        {
          type: 'message',
          id: 'failed',
          parentId: 'q2',
          timestamp: at(21),
          message: { role: 'assistant', stopReason: 'error', errorMessage: 'overloaded', content: [] }
        }
      ])
    )

    await sync()

    expect(rows().at(-1)?.status).toBe('error')
  })
})
