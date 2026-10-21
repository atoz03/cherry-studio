/**
 * Read and write the pi CLI's session files (`~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl`, see
 * pi's docs/session-format.md). Cherry shares these files with the user's terminal pi, so every
 * write here is a new file; existing sessions are only appended to by pi itself.
 */
import { constants } from 'node:fs'
import { copyFile, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'

export interface PiSessionHeader {
  type: 'session'
  id: string
  version?: number
  timestamp?: string
  cwd?: string
  parentSession?: string
}

export interface PiSessionEntry {
  type: string
  id: string
  parentId: string | null
  timestamp?: string
  [key: string]: unknown
}

export interface PiSession {
  header: PiSessionHeader | undefined
  entries: PiSessionEntry[]
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/** Session ids become file names, so anything that could traverse or glob is rejected. */
export function assertPiSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error(`Invalid pi session id: ${sessionId}`)
}

/** pi's `getDefaultSessionDir` encoding of a working directory. */
export function piSessionDirectory(cwd: string): string {
  const encoded = path
    .resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')
  return path.join(application.getPath('external.pi.sessions'), `--${encoded}--`)
}

async function findSessionFileIn(directory: string, sessionId: string): Promise<string | null> {
  assertPiSessionId(sessionId)
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  // pi owns the timestamp prefix; when an id is recreated, the greatest timestamp is newest.
  const match = names
    .filter((name) => name.endsWith(`_${sessionId}.jsonl`))
    .sort()
    .at(-1)
  return match ? path.join(directory, match) : null
}

/** The session file pi uses for `--session-id <id>` in `cwd`, or null before pi has written it. */
export function findPiSessionFile(cwd: string, sessionId: string): Promise<string | null> {
  return findSessionFileIn(piSessionDirectory(cwd), sessionId)
}

/** Move a session of the former bundled runtime into pi's store, where the CLI can resume it too. */
export async function adoptLegacyPiSession(cwd: string, sessionId: string): Promise<void> {
  const legacy = await findSessionFileIn(application.getPath('feature.agents.pi.legacy_sessions'), sessionId)
  if (!legacy || (await findPiSessionFile(cwd, sessionId))) return
  const directory = piSessionDirectory(cwd)
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, path.basename(legacy))
  try {
    await rename(legacy, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(legacy, target, constants.COPYFILE_EXCL)
    await unlink(legacy)
  }
}

/** Parse a session file. Only a torn final line (pi was killed mid-append) is tolerated. */
export async function readPiSession(file: string): Promise<PiSession> {
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim())
  let header: PiSessionHeader | undefined
  const entries: PiSessionEntry[] = []
  for (const [index, line] of lines.entries()) {
    let record: { type?: unknown; id?: unknown }
    try {
      record = JSON.parse(line)
    } catch (error) {
      if (index === lines.length - 1) break
      throw error
    }
    if (record.type === 'session') header = record as PiSessionHeader
    else if (typeof record.id === 'string') entries.push(record as PiSessionEntry)
  }
  return { header, entries }
}

/** Root-to-leaf path of `leafId`, or of the current leaf (pi's last appended entry) when omitted. */
export function piSessionBranch(entries: readonly PiSessionEntry[], leafId?: string): PiSessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const branch: PiSessionEntry[] = []
  let current = leafId === undefined ? entries.at(-1) : byId.get(leafId)
  while (current && branch.length <= entries.length) {
    branch.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return branch.reverse()
}

/** Size and current leaf of a session file, read from its tail so long sessions stay cheap. */
export async function readPiSessionTail(file: string): Promise<{ size: number; leafId: string | undefined }> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    let end = size
    let tail = ''
    while (end > 0) {
      const start = Math.max(0, end - 64 * 1024)
      const buffer = Buffer.alloc(end - start)
      await handle.read(buffer, 0, buffer.length, start)
      tail = buffer.toString('utf8') + tail
      end = start
      const lines = tail.split('\n').filter((line) => line.trim())
      // The first line of a partial read may be cut, so only trust lines after a newline.
      for (let index = lines.length - 1; index >= (end > 0 ? 1 : 0); index -= 1) {
        try {
          const record = JSON.parse(lines[index]) as { type?: unknown; id?: unknown }
          if (record.type !== 'session' && typeof record.id === 'string') return { size, leafId: record.id }
        } catch {
          // A torn final line; keep looking further back.
        }
      }
    }
    return { size, leafId: undefined }
  } finally {
    await handle.close()
  }
}

/** Current size of a session file, or 0 before pi has written it. */
export async function piSessionFileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

/**
 * Write a new session holding `source`'s path up to `leafId`, as pi's `createBranchedSession` does.
 * Entry ids are kept, so checkpoints taken in the source stay valid in the copy.
 */
export async function writeBranchedPiSession(input: {
  source: PiSession
  sourceFile: string
  leafId: string
  cwd: string
  directory: string
}): Promise<{ file: string; sessionId: string; entryIds: ReadonlySet<string> }> {
  const branch = piSessionBranch(input.source.entries, input.leafId)
  if (branch.at(-1)?.id !== input.leafId) throw new Error(`pi entry ${input.leafId} not found`)
  const sessionId = uuidv7()
  const timestamp = new Date().toISOString()
  const header: PiSessionHeader = {
    type: 'session',
    version: input.source.header?.version ?? 3,
    id: sessionId,
    timestamp,
    cwd: path.resolve(input.cwd),
    parentSession: input.sourceFile
  }
  const file = path.join(input.directory, `${timestamp.replace(/[:.]/g, '-')}_${sessionId}.jsonl`)
  const lines = [header, ...branch].map((record) => JSON.stringify(record))
  await writeFile(file, `${lines.join('\n')}\n`, { flag: 'wx', mode: 0o600 })
  return { file, sessionId, entryIds: new Set(branch.map((entry) => entry.id)) }
}

export interface PiSessionSummary {
  sessionId: string
  cwd: string
  name: string | undefined
  firstMessage: string
  modifiedAt: number
}

/** Every session in pi's store that has a user message, newest first, for the import picker. */
export async function listPiSessions(): Promise<PiSessionSummary[]> {
  const root = application.getPath('external.pi.sessions')
  let directories: string[]
  try {
    directories = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const summaries: PiSessionSummary[] = []
  for (const directory of directories) {
    let names: string[]
    try {
      names = (await readdir(path.join(root, directory))).filter((name) => name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of names) {
      const file = path.join(root, directory, name)
      try {
        const [{ header, entries }, { mtimeMs }] = await Promise.all([readPiSession(file), stat(file)])
        const firstUser = entries.find((entry) => piMessageRole(entry) === 'user')
        if (!header?.cwd || !SESSION_ID_PATTERN.test(header.id) || !firstUser) continue
        const name = entries.findLast((entry) => entry.type === 'session_info')?.name
        summaries.push({
          sessionId: header.id,
          cwd: header.cwd,
          name: typeof name === 'string' && name ? name : undefined,
          firstMessage: piMessageText(firstUser).slice(0, 200),
          modifiedAt: mtimeMs
        })
      } catch {
        // An unreadable file is skipped rather than hiding every other session.
      }
    }
  }
  return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** The `AgentMessage` role of a `message` entry. */
export function piMessageRole(entry: PiSessionEntry): string | undefined {
  if (entry.type !== 'message') return undefined
  const role = (entry.message as { role?: unknown } | undefined)?.role
  return typeof role === 'string' ? role : undefined
}

/** Plain text of a user message entry (string content or its text blocks). */
export function piMessageText(entry: PiSessionEntry): string {
  const content = (entry.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block: { type?: unknown; text?: unknown }) =>
      block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )
    .join('\n')
}
