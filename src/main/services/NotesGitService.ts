import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { assertOutsideManagedStorageMutation, runPathMutationExclusive } from '@main/services/file'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { atomicWriteFile, exists, isPathInside, isSameFile, isSameOrInside, realpath, stat } from '@main/utils/file'
import { crossPlatformSpawn, killProcessTree } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesErrorCodes } from '@shared/ipc/errors/notes'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import type {
  NotesGitCommit,
  NotesGitFileDiff,
  NotesGitStatus,
  NotesGitUnavailableReason
} from '@shared/types/notesGit'

const logger = loggerService.withContext('NotesGitService')

const COMMAND_TIMEOUT_MS = 30_000
const MAX_DIFF_BYTES = 1024 * 1024
const MAX_RESTORE_BYTES = 64 * 1024 * 1024
const MAX_HISTORY_ENTRIES = 500
const REVISION_PATTERN = /^[0-9a-f]{7,64}$/i
/** Used only when the user has no git identity configured; never written to any config. */
const FALLBACK_IDENTITY = { 'user.name': 'Cherry Studio', 'user.email': 'notes@cherry-studio.local' }
/** Present in the git dir while a merge/rebase/… waits for the user, or while another git process runs. */
const BUSY_MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply',
  'index.lock'
]
/** Variables that would point git at a different repository than the notes folder. */
const REPOSITORY_ENV_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES'
]

interface GitResult {
  code: number | null
  stdout: Buffer
  stderr: string
  /** stdout went past `maxBytes` and was cut there (only with `truncate`). */
  truncated: boolean
}

interface GitRunner {
  root: AbsoluteFilePath
  run: (args: string[], options?: { maxBytes?: number; truncate?: boolean }) => Promise<GitResult>
}

type Resolved =
  | { ok: true; git: GitRunner; repository: 'none' }
  | { ok: true; git: GitRunner; repository: 'existing'; gitDir: string }
  | { ok: false; reason: NotesGitUnavailableReason }

type Repository = GitRunner & { gitDir: string }

const absolute = (value: string): AbsoluteFilePath => AbsoluteFilePathSchema.parse(value)

/** `YYYY-MM-DD HH:mm:ss` in local time — the v1 fork's auto-commit message. */
export function formatCommitTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function runGit(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  { maxBytes = MAX_RESTORE_BYTES, truncate = false }: { maxBytes?: number; truncate?: boolean } = {}
): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = crossPlatformSpawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ''
    let truncated = false
    let overflow = false

    const timer = setTimeout(() => {
      stderr += `\ngit ${args[0]} timed out`
      killProcessTree(child)
    }, COMMAND_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated || overflow) return
      if (size + chunk.length > maxBytes) {
        if (truncate) {
          chunks.push(chunk.subarray(0, maxBytes - size))
          truncated = true
        } else {
          overflow = true
        }
        killProcessTree(child)
        return
      }
      chunks.push(chunk)
      size += chunk.length
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: error.message, truncated: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: overflow ? null : code,
        stdout: Buffer.concat(chunks),
        stderr: overflow ? 'output too large' : stderr.trim(),
        truncated
      })
    })
  })
}

function commandFailed(action: string, result: GitResult): IpcError {
  return new IpcError(notesErrorCodes.GIT_COMMAND_FAILED, `git ${action} failed: ${result.stderr || 'unknown error'}`)
}

/**
 * Git versioning for the notes folder, ported from the v1 fork. Holds no resources: every call
 * spawns git on demand, and the renderer drives auto-commits only while the notes page is open.
 *
 * Safety with a repository the user already owns: it is used only when the notes folder is its
 * top level; history is never rewritten (no reset/amend/checkout — restore writes the file and
 * moves forward); auto-commit skips while a merge/rebase/… is in progress or HEAD is detached;
 * git config is never written.
 */
export class NotesGitService {
  private queue: Promise<unknown> = Promise.resolve()

  async getStatus(): Promise<NotesGitStatus> {
    const resolved = await this.resolve()
    if (!resolved.ok) return { available: false, reason: resolved.reason }
    return { available: true, repository: resolved.repository }
  }

  /** Commit every pending change in the notes folder, creating the repository on first use. */
  autoCommit(): Promise<{ committed: boolean }> {
    return this.exclusive(async () => {
      const resolved = await this.resolve()
      if (!resolved.ok) return { committed: false }
      const repository =
        resolved.repository === 'none' ? await this.init(resolved.git) : { ...resolved.git, gitDir: resolved.gitDir }
      if (!repository || (await this.isBusy(repository))) return { committed: false }
      return { committed: await this.commitAll(repository) }
    })
  }

  async getFileHistory(filePath: string): Promise<NotesGitCommit[]> {
    const repository = await this.requireRepository()
    if (!repository) return []
    const relative = this.toRelative(repository.root, filePath)
    if ((await repository.run(['rev-parse', '-q', '--verify', 'HEAD'])).code !== 0) return []

    const result = await repository.run([
      '--literal-pathspecs',
      'log',
      '-z',
      `--max-count=${MAX_HISTORY_ENTRIES}`,
      '--format=%H%x1f%aI%x1f%s',
      '--',
      relative
    ])
    if (result.code !== 0) throw commandFailed('log', result)
    return result.stdout
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((record) => {
        const [hash = '', date = '', message = ''] = record.split('\x1f')
        return { hash, date, message }
      })
  }

  /** Diff from the version at `revision` to the file as it is on disk now (v1 semantics). */
  async getFileDiff(filePath: string, revision: string): Promise<NotesGitFileDiff> {
    const repository = await this.requireRepository(true)
    const relative = this.toRelative(repository.root, filePath)
    this.assertRevision(revision)

    const result = await repository.run(
      ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', revision, '--', relative],
      { maxBytes: MAX_DIFF_BYTES, truncate: true }
    )
    if (!result.truncated && result.code !== 0) {
      throw new IpcError(notesErrorCodes.GIT_REVISION_NOT_FOUND, `Unknown revision ${revision}`)
    }
    return { diff: result.stdout.toString('utf8'), truncated: result.truncated }
  }

  /**
   * Overwrite the file with its content at `revision`. Pending changes are committed first so the
   * content being replaced stays in history; the restored content is committed by the next
   * auto-commit like any other edit.
   */
  restoreFile(filePath: string, revision: string): Promise<void> {
    return this.exclusive(async () => {
      const repository = await this.requireRepository(true)
      const relative = this.toRelative(repository.root, filePath)
      this.assertRevision(revision)
      const target = absolute(path.join(repository.root, ...relative.split('/')))
      await this.assertWritable(repository.root, target)

      // `--filters` applies the repo's eol/smudge settings, as a git checkout of the file would.
      const blob = await repository.run(['cat-file', '--filters', `${revision}:${relative}`])
      if (blob.code !== 0) {
        throw new IpcError(notesErrorCodes.GIT_REVISION_NOT_FOUND, `${relative} is not in ${revision}`)
      }
      if (await this.isBusy(repository)) {
        throw new IpcError(notesErrorCodes.GIT_REPOSITORY_BUSY, 'The notes repository has an operation in progress')
      }
      await this.commitAll(repository)
      await runPathMutationExclusive(() => atomicWriteFile(target, blob.stdout))
      logger.info('Restored note from git history', { relative, revision })
    })
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async requireRepository(): Promise<Repository | null>
  private async requireRepository(mustExist: true): Promise<Repository>
  private async requireRepository(mustExist = false): Promise<Repository | null> {
    const resolved = await this.resolve()
    if (!resolved.ok) {
      throw new IpcError(notesErrorCodes.GIT_UNAVAILABLE, `Notes git is unavailable: ${resolved.reason}`, {
        reason: resolved.reason
      })
    }
    if (resolved.repository === 'existing') return { ...resolved.git, gitDir: resolved.gitDir }
    if (mustExist) throw new IpcError(notesErrorCodes.GIT_REVISION_NOT_FOUND, 'The notes folder has no history yet')
    return null
  }

  private async resolve(): Promise<Resolved> {
    const preferences = application.get('PreferenceService')
    if (!preferences.get('feature.notes.git.enabled')) return { ok: false, reason: 'disabled' }

    const configuredRoot = preferences.get('feature.notes.path').trim()
    if (!configuredRoot) return { ok: false, reason: 'notes_path_missing' }
    if (!path.isAbsolute(configuredRoot)) return { ok: false, reason: 'notes_path_invalid' }
    const root = absolute(path.resolve(configuredRoot))
    try {
      if (!(await stat(root)).isDirectory) return { ok: false, reason: 'notes_path_invalid' }
    } catch {
      return { ok: false, reason: 'notes_path_invalid' }
    }

    const shellEnv = await getShellEnv()
    const command = await findExecutableInEnv('git', { env: shellEnv })
    if (!command) return { ok: false, reason: 'git_not_found' }
    const env: NodeJS.ProcessEnv = { ...shellEnv, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    for (const name of REPOSITORY_ENV_VARS) delete env[name]
    const git: GitRunner = { root, run: (args, options) => runGit(command, args, root, env, options) }

    const probe = await git.run(['rev-parse', '--show-toplevel', '--absolute-git-dir'])
    if (probe.code === null) {
      logger.warn('git could not be run in the notes folder', { root, stderr: probe.stderr })
      return { ok: false, reason: probe.stderr.includes('ENOENT') ? 'git_not_found' : 'repository_error' }
    }
    if (probe.code === 0) {
      const [topLevel = '', gitDir = ''] = probe.stdout.toString('utf8').trim().split('\n')
      if (!(await isSameFile(absolute(path.resolve(topLevel)), root))) {
        return { ok: false, reason: 'nested_repository' }
      }
      return { ok: true, git, repository: 'existing', gitDir: path.resolve(gitDir) }
    }
    // git could not open a repository; if one is there anyway, leave it alone.
    if (await this.hasGitEntryAtOrAbove(root)) {
      logger.warn('Notes folder repository is unreadable, leaving it untouched', { root, stderr: probe.stderr })
      return { ok: false, reason: 'repository_error' }
    }
    return { ok: true, git, repository: 'none' }
  }

  private async hasGitEntryAtOrAbove(start: string): Promise<boolean> {
    for (let dir = start; ; dir = path.dirname(dir)) {
      if (await exists(absolute(path.join(dir, '.git')))) return true
      if (path.dirname(dir) === dir) return false
    }
  }

  private async init(git: GitRunner): Promise<Repository | null> {
    const result = await git.run(['init', '--quiet'])
    if (result.code !== 0) {
      logger.warn('Failed to create the notes repository', { root: git.root, stderr: result.stderr })
      return null
    }
    logger.info('Created the notes repository', { root: git.root })
    return { ...git, gitDir: path.join(git.root, '.git') }
  }

  private async isBusy(repository: Repository): Promise<boolean> {
    for (const marker of BUSY_MARKERS) {
      if (await exists(absolute(path.join(repository.gitDir, marker)))) return true
    }
    // Detached HEAD: a commit there would be left off every branch.
    return (await repository.run(['symbolic-ref', '-q', 'HEAD'])).code !== 0
  }

  /** Stage and commit everything under the notes folder; false when there was nothing to commit. */
  private async commitAll(repository: Repository): Promise<boolean> {
    const status = await repository.run(['status', '--porcelain', '-z', '--untracked-files=all'])
    if (status.code !== 0) throw commandFailed('status', status)
    if (status.stdout.length === 0) return false

    const add = await repository.run(['add', '-A'])
    if (add.code !== 0) throw commandFailed('add', add)
    if ((await repository.run(['diff', '--cached', '--quiet'])).code === 0) return false

    const identity: string[] = []
    for (const [key, value] of Object.entries(FALLBACK_IDENTITY)) {
      const configured = await repository.run(['config', '--get', key])
      if (configured.code !== 0 || !configured.stdout.toString('utf8').trim()) identity.push('-c', `${key}=${value}`)
    }
    // Background commits must not wait on a signing passphrase or run the user's hooks.
    const commit = await repository.run([
      '-c',
      'commit.gpgsign=false',
      ...identity,
      'commit',
      '--no-verify',
      '--quiet',
      '-m',
      formatCommitTimestamp(new Date())
    ])
    if (commit.code !== 0) throw commandFailed('commit', commit)
    return true
  }

  /** Validated path of `filePath` relative to the notes folder, `/`-separated as git expects. */
  private toRelative(root: string, filePath: string): string {
    const absolute = path.resolve(filePath)
    if (!path.isAbsolute(filePath) || !isPathInside(absolute, root)) {
      throw new IpcError(notesErrorCodes.GIT_INVALID_PATH, 'Path is outside the notes folder')
    }
    const segments = path.relative(root, absolute).split(path.sep)
    if (segments.some((segment) => segment.toLowerCase() === '.git')) {
      throw new IpcError(notesErrorCodes.GIT_INVALID_PATH, 'Path is inside the repository metadata')
    }
    return segments.join('/')
  }

  private assertRevision(revision: string): void {
    if (!REVISION_PATTERN.test(revision)) {
      throw new IpcError(notesErrorCodes.GIT_REVISION_NOT_FOUND, 'Invalid revision')
    }
  }

  /** The restore target must physically live in the notes folder (no symlinked escape). */
  private async assertWritable(root: AbsoluteFilePath, target: AbsoluteFilePath): Promise<void> {
    try {
      const realRoot = await realpath(root)
      const realParent = await realpath(absolute(path.dirname(target)))
      if (!isSameOrInside(realParent, realRoot)) throw new Error('outside')
    } catch {
      throw new IpcError(notesErrorCodes.GIT_INVALID_PATH, 'Path is outside the notes folder')
    }
    await assertOutsideManagedStorageMutation(target)
  }
}

export const notesGitService = new NotesGitService()
