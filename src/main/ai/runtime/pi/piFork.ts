import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { agentSessionService } from '@data/services/AgentSessionService'
import { readForkPrefix, readNativeForkHistory } from '@main/ai/runtime/fork'

import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../fork'
import { parsePiForkCheckpoint } from './forkCheckpoint'
import { findPiSessionFile, piSessionDirectory, readPiSession, writeBranchedPiSession } from './piSessionFiles'

export async function forkPiSession(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  return readNativeForkHistory(() => preparePiFork(input))
}

async function preparePiFork(input: RuntimeForkInput): Promise<RuntimeForkResult> {
  const checkpoint = parsePiForkCheckpoint(input.checkpoint)
  const sourceCwd = agentSessionService.getById(input.sourceSessionId)?.workspace?.path
  if (!sourceCwd) throw new AgentSessionForkError('history_missing')
  let sourceFile: string | null
  try {
    sourceFile = await findPiSessionFile(sourceCwd, checkpoint.runtimeSessionId)
  } catch {
    throw new AgentSessionForkError('history_corrupt')
  }
  if (!sourceFile) throw new AgentSessionForkError('history_missing')
  // Snapshot a committed prefix: the user's terminal pi may still be appending to the source.
  const directory = path.join(input.artifactDirectory, 'pi')
  await mkdir(directory, { recursive: false })
  const snapshotFile = path.join(directory, 'source.jsonl')
  await writeFile(snapshotFile, await readForkPrefix(sourceFile), { flag: 'wx', mode: 0o600 })
  input.signal.throwIfAborted()
  const source = await readPiSession(snapshotFile)
  if (source.header?.id !== checkpoint.runtimeSessionId) throw new AgentSessionForkError('history_changed')
  if (!source.entries.some((entry) => entry.id === checkpoint.leafId)) {
    throw new AgentSessionForkError('history_changed')
  }
  const branched = await writeBranchedPiSession({
    source,
    sourceFile,
    leafId: checkpoint.leafId,
    cwd: input.targetCwd,
    directory
  })
  const checkpoints = input.checkpoints.map(parsePiForkCheckpoint).map((value) => {
    if (value.runtimeSessionId !== checkpoint.runtimeSessionId || !branched.entryIds.has(value.leafId)) {
      throw new AgentSessionForkError('history_corrupt')
    }
    return { ...value, runtimeSessionId: branched.sessionId }
  })
  return {
    resumeToken: branched.sessionId,
    checkpoints,
    publish: [
      {
        source: branched.file,
        target: path.join(piSessionDirectory(input.targetCwd), path.basename(branched.file))
      }
    ]
  }
}
