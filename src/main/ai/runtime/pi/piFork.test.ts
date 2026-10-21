import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'

import type { RuntimeForkInput } from '../fork'
import { forkPiSession } from './piFork'
import { piSessionDirectory, readPiSession } from './piSessionFiles'

const sourceCwd = '/work/source'
const targetCwd = '/work/target'
let root: string
let artifactDirectory: string

const checkpoint = (leafId: string, runtimeSessionId = 'src') => ({ runtime: 'pi', runtimeSessionId, leafId })

function forkInput(fields: Partial<RuntimeForkInput> = {}): RuntimeForkInput {
  return {
    sourceSessionId: 'session-1',
    checkpoint: checkpoint('b'),
    checkpoints: [checkpoint('a'), checkpoint('b')],
    targetSessionId: 'session-2',
    targetCwd,
    artifactDirectory,
    signal: new AbortController().signal,
    ...fields
  }
}

describe('forkPiSession', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cherry-pi-fork-'))
    artifactDirectory = path.join(root, 'artifacts')
    mkdirSync(artifactDirectory)
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      key === 'external.pi.sessions' ? path.join(root, 'store') : getPath(key, filename)
    )
    const file = path.join(piSessionDirectory(sourceCwd), '2026-10-01T00-00-00-000Z_src.jsonl')
    mkdirSync(path.dirname(file), { recursive: true })
    const records = [
      { type: 'session', version: 3, id: 'src', cwd: sourceCwd },
      { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'first' } },
      { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: [] } },
      { type: 'message', id: 'c', parentId: 'b', message: { role: 'user', content: 'later' } }
    ]
    writeFileSync(file, records.map((record) => JSON.stringify(record) + '\n').join(''))

    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace-1', name: 'Workspace', path: sourceCwd, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session-1', workspaceId: 'workspace-1', name: 'Session', orderKey: 'a0' })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('gives the fork its own pi session that ends at the chosen turn', async () => {
    const result = await forkPiSession(forkInput())

    expect(result.resumeToken).not.toBe('src')
    expect(result.checkpoints).toEqual([checkpoint('a', result.resumeToken), checkpoint('b', result.resumeToken)])
    const [{ source, target }] = result.publish
    expect(path.dirname(target)).toBe(piSessionDirectory(targetCwd))
    expect(path.basename(target)).toMatch(new RegExp(`_${result.resumeToken}\\.jsonl$`))
    const forked = await readPiSession(source)
    expect(forked.header).toMatchObject({ id: result.resumeToken, cwd: targetCwd })
    expect(forked.entries.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('refuses a turn the pi session no longer has', async () => {
    await expect(forkPiSession(forkInput({ checkpoint: checkpoint('gone') }))).rejects.toMatchObject({
      reason: 'history_changed'
    })
  })

  it('refuses checkpoints from another pi session', async () => {
    await expect(
      forkPiSession(forkInput({ checkpoints: [checkpoint('a', 'other'), checkpoint('b')] }))
    ).rejects.toMatchObject({ reason: 'history_corrupt' })
  })

  it('reports missing history when the pi session file is gone', async () => {
    rmSync(path.join(root, 'store'), { recursive: true })

    await expect(forkPiSession(forkInput())).rejects.toMatchObject({ reason: 'history_missing' })
  })
})
