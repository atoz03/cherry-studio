import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { application } from '@application'

import {
  adoptLegacyPiSession,
  findPiSessionFile,
  listPiSessions,
  type PiSessionEntry,
  piSessionBranch,
  piSessionDirectory,
  readPiSession,
  readPiSessionTail,
  writeBranchedPiSession
} from './piSessionFiles'

let root: string
let store: string
let legacy: string
const cwd = '/work/project'

function entry(id: string, parentId: string | null, text = id): PiSessionEntry {
  return { type: 'message', id, parentId, message: { role: 'user', content: text } }
}

function writeSession(file: string, records: object[]): string {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  return file
}

const header = (id: string, sessionCwd = cwd) => ({ type: 'session', version: 3, id, cwd: sessionCwd })

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cherry-pi-sessions-'))
  store = path.join(root, 'store')
  legacy = path.join(root, 'legacy')
  ;(application.getPath as Mock).mockImplementation((key: string) =>
    key === 'external.pi.sessions' ? store : key === 'feature.agents.pi.legacy_sessions' ? legacy : root
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.mocked(application.getPath as Mock).mockReset()
})

describe('pi session files', () => {
  it.runIf(process.platform !== 'win32')('stores sessions where the pi CLI looks for them', () => {
    expect(piSessionDirectory('/home/u/my.proj')).toBe(path.join(store, '--home-u-my.proj--'))
  })

  it('finds the newest file of a session and nothing for an unknown one', async () => {
    const directory = piSessionDirectory(cwd)
    writeSession(path.join(directory, '2026-01-01T00-00-00-000Z_abc.jsonl'), [header('abc')])
    const newest = writeSession(path.join(directory, '2026-02-01T00-00-00-000Z_abc.jsonl'), [header('abc')])

    await expect(findPiSessionFile(cwd, 'abc')).resolves.toBe(newest)
    await expect(findPiSessionFile(cwd, 'other')).resolves.toBeNull()
    await expect(findPiSessionFile('/never/used', 'abc')).resolves.toBeNull()
    await expect(findPiSessionFile(cwd, '../abc')).rejects.toThrow('Invalid pi session id')
  })

  it('tolerates only a torn final line', async () => {
    const torn = path.join(root, 'torn.jsonl')
    writeFileSync(torn, `${JSON.stringify(header('s'))}\n${JSON.stringify(entry('a', null))}\n{"type":"mess`)
    await expect(readPiSession(torn)).resolves.toMatchObject({ header: { id: 's' }, entries: [{ id: 'a' }] })

    const corrupt = path.join(root, 'corrupt.jsonl')
    writeFileSync(corrupt, `${JSON.stringify(header('s'))}\n{"broken\n${JSON.stringify(entry('a', null))}\n`)
    await expect(readPiSession(corrupt)).rejects.toThrow()
  })

  it('follows the active branch from the leaf, leaving abandoned branches out', () => {
    const entries = [entry('a', null), entry('b', 'a'), entry('abandoned', 'b'), entry('c', 'b'), entry('d', 'c')]

    expect(piSessionBranch(entries).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(piSessionBranch(entries, 'abandoned').map((e) => e.id)).toEqual(['a', 'b', 'abandoned'])
  })

  it('reads the current leaf from the tail of a long session', async () => {
    const file = path.join(root, 'long.jsonl')
    const records = [
      header('s'),
      ...Array.from({ length: 400 }, (_, i) => entry(`e${i}`, i ? `e${i - 1}` : null, 'x'.repeat(500)))
    ]
    writeFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n{"type":"message","id":"torn')

    const tail = await readPiSessionTail(file)

    expect(tail.leafId).toBe('e399')
    expect(tail.size).toBe(readFileSync(file).length)
  })

  it('branches a session into a new file that keeps entry ids and links its parent', async () => {
    const sourceFile = writeSession(path.join(root, 'source.jsonl'), [
      header('src'),
      entry('a', null),
      entry('b', 'a'),
      entry('c', 'b')
    ])
    const source = await readPiSession(sourceFile)

    const branched = await writeBranchedPiSession({ source, sourceFile, leafId: 'b', cwd, directory: root })
    const copy = await readPiSession(branched.file)

    expect(copy.header).toMatchObject({ id: branched.sessionId, cwd: path.resolve(cwd), parentSession: sourceFile })
    expect(copy.entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect([...branched.entryIds]).toEqual(['a', 'b'])
    expect(path.basename(branched.file).endsWith(`_${branched.sessionId}.jsonl`)).toBe(true)
    await expect(
      writeBranchedPiSession({ source, sourceFile, leafId: 'missing', cwd, directory: root })
    ).rejects.toThrow()
  })

  it('moves a session of the former bundled runtime into the pi store once', async () => {
    const old = writeSession(path.join(legacy, '2026-01-01T00-00-00-000Z_s1.jsonl'), [header('s1')])

    await adoptLegacyPiSession(cwd, 's1')

    expect(existsSync(old)).toBe(false)
    expect(await findPiSessionFile(cwd, 's1')).toBe(path.join(piSessionDirectory(cwd), path.basename(old)))

    // pi already has the session: a stray legacy copy is left alone.
    const stray = writeSession(old, [header('s1')])
    await adoptLegacyPiSession(cwd, 's1')
    expect(existsSync(stray)).toBe(true)
    expect(readdirSync(piSessionDirectory(cwd))).toHaveLength(1)
  })

  it('lists sessions newest first and skips files that are not sessions', async () => {
    const older = writeSession(path.join(store, '--a--', '1_old.jsonl'), [
      header('old', '/a'),
      { type: 'message', id: 'u', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }
    ])
    const newer = writeSession(path.join(store, '--b--', '2_new.jsonl'), [
      header('new', '/b'),
      { type: 'session_info', id: 'n', parentId: null, name: 'Named' }
    ])
    writeSession(path.join(store, '--b--', '3_bad.jsonl'), [{ type: 'message', id: 'x', parentId: null }])
    utimesSync(older, 1000, 1000)
    utimesSync(newer, 2000, 2000)

    await expect(listPiSessions()).resolves.toMatchObject([
      { sessionId: 'new', cwd: '/b', name: 'Named', firstMessage: undefined },
      { sessionId: 'old', cwd: '/a', name: undefined, firstMessage: 'hi' }
    ])
  })
})
