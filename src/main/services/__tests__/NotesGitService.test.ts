import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { notesErrorCodes } from '@shared/ipc/errors/notes'

import { NotesGitService } from '../NotesGitService'

let sandbox: string
/** Git environment isolated from the machine running the tests: no global/system config or identity. */
let gitEnv: Record<string, string>

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => gitEnv }))

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim()
const userGit = (cwd: string, ...args: string[]): string =>
  git(cwd, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.com', ...args)
const commitCount = (cwd: string): number => Number(git(cwd, 'rev-list', '--count', 'HEAD'))

const makeDir = (...segments: string[]): string => {
  const dir = path.join(sandbox, ...segments)
  mkdirSync(dir, { recursive: true })
  return dir
}

const configureNotes = (notesPath: string, enabled = true) => {
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', notesPath)
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.git.enabled', enabled)
}

const expectIpcError = async (operation: Promise<unknown>, code: string) => {
  await expect(operation).rejects.toMatchObject({ code })
}

let service: NotesGitService

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), 'notes-git-'))
  const home = makeDir('home')
  gitEnv = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1'
  }
  MockMainPreferenceServiceUtils.resetMocks()
  service = new NotesGitService()
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('NotesGitService status', () => {
  it('reports why versioning cannot run', async () => {
    const notes = makeDir('notes')

    configureNotes(notes, false)
    expect(await service.getStatus()).toEqual({ available: false, reason: 'disabled' })

    configureNotes('')
    expect(await service.getStatus()).toEqual({ available: false, reason: 'notes_path_missing' })

    configureNotes(path.join(sandbox, 'missing'))
    expect(await service.getStatus()).toEqual({ available: false, reason: 'notes_path_invalid' })

    gitEnv.PATH = makeDir('empty-bin')
    configureNotes(notes)
    expect(await service.getStatus()).toEqual({ available: false, reason: 'git_not_found' })
  })

  it('does nothing at all while versioning is off', async () => {
    const notes = makeDir('notes')
    writeFileSync(path.join(notes, 'a.md'), 'a')
    configureNotes(notes, false)

    expect(await service.autoCommit()).toEqual({ committed: false })
    expect(existsSync(path.join(notes, '.git'))).toBe(false)
    await expectIpcError(service.getFileHistory(path.join(notes, 'a.md')), notesErrorCodes.GIT_UNAVAILABLE)
  })
})

describe('NotesGitService auto-commit', () => {
  it('creates the repository on first use and commits pending changes with a timestamp message', async () => {
    const notes = makeDir('notes')
    writeFileSync(path.join(notes, 'a.md'), '# A')
    configureNotes(notes)
    expect(await service.getStatus()).toEqual({ available: true, repository: 'none' })

    expect(await service.autoCommit()).toEqual({ committed: true })

    expect(await service.getStatus()).toEqual({ available: true, repository: 'existing' })
    expect(git(notes, 'log', '-1', '--format=%s')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(git(notes, 'show', 'HEAD:a.md')).toBe('# A')
    // No identity was configured, so a fallback is used for the commit without writing any config.
    expect(git(notes, 'log', '-1', '--format=%an <%ae>')).toBe('Cherry Studio <notes@cherry-studio.local>')
    expect(readFileSync(path.join(notes, '.git', 'config'), 'utf8')).not.toContain('[user]')
  })

  it('commits only when something changed', async () => {
    const notes = makeDir('notes')
    writeFileSync(path.join(notes, 'a.md'), 'one')
    configureNotes(notes)
    await service.autoCommit()

    expect(await service.autoCommit()).toEqual({ committed: false })
    expect(commitCount(notes)).toBe(1)

    writeFileSync(path.join(notes, 'a.md'), 'two')
    writeFileSync(path.join(notes, 'b.md'), 'new')
    expect(await service.autoCommit()).toEqual({ committed: true })
    expect(commitCount(notes)).toBe(2)
    expect(git(notes, 'status', '--porcelain')).toBe('')
  })

  it('adds to an existing repository without touching its history or config', async () => {
    const notes = makeDir('notes')
    git(notes, 'init', '-q')
    writeFileSync(path.join(notes, 'a.md'), 'mine')
    userGit(notes, 'add', '-A')
    userGit(notes, 'commit', '-q', '-m', 'my commit')
    const userHead = git(notes, 'rev-parse', 'HEAD')
    const config = readFileSync(path.join(notes, '.git', 'config'), 'utf8')
    configureNotes(notes)

    writeFileSync(path.join(notes, 'a.md'), 'edited')
    expect(await service.autoCommit()).toEqual({ committed: true })

    expect(git(notes, 'rev-parse', 'HEAD~1')).toBe(userHead)
    expect(git(notes, 'log', '--format=%s', '-1', userHead)).toBe('my commit')
    expect(readFileSync(path.join(notes, '.git', 'config'), 'utf8')).toBe(config)
  })

  it('skips while a merge is in progress or HEAD is detached', async () => {
    const notes = makeDir('notes')
    writeFileSync(path.join(notes, 'a.md'), 'one')
    configureNotes(notes)
    await service.autoCommit()
    const head = git(notes, 'rev-parse', 'HEAD')

    writeFileSync(path.join(notes, '.git', 'MERGE_HEAD'), `${head}\n`)
    writeFileSync(path.join(notes, 'a.md'), 'two')
    expect(await service.autoCommit()).toEqual({ committed: false })
    expect(git(notes, 'rev-parse', 'HEAD')).toBe(head)
    rmSync(path.join(notes, '.git', 'MERGE_HEAD'))

    git(notes, 'checkout', '-q', '--detach')
    expect(await service.autoCommit()).toEqual({ committed: false })
    expect(git(notes, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('never creates a repository inside another one', async () => {
    const outer = makeDir('outer')
    git(outer, 'init', '-q')
    const notes = makeDir('outer', 'notes')
    writeFileSync(path.join(notes, 'a.md'), 'a')
    configureNotes(notes)

    expect(await service.getStatus()).toEqual({ available: false, reason: 'nested_repository' })
    expect(await service.autoCommit()).toEqual({ committed: false })
    expect(existsSync(path.join(notes, '.git'))).toBe(false)
    expect(git(outer, 'rev-list', '--all')).toBe('')
  })

  it('leaves an unreadable repository alone', async () => {
    const notes = makeDir('notes')
    writeFileSync(path.join(notes, '.git'), 'gitdir: /nonexistent/repo\n')
    writeFileSync(path.join(notes, 'a.md'), 'a')
    configureNotes(notes)

    expect(await service.getStatus()).toEqual({ available: false, reason: 'repository_error' })
    expect(await service.autoCommit()).toEqual({ committed: false })
    expect(readFileSync(path.join(notes, '.git'), 'utf8')).toBe('gitdir: /nonexistent/repo\n')
  })
})

describe('NotesGitService history, diff and restore', () => {
  /** A notes repo where `note.md` went v1 → v2 → v3, with an unrelated commit in between. */
  const setUpHistory = async () => {
    const notes = makeDir('notes')
    const note = path.join(notes, 'sub dir', 'note.md')
    mkdirSync(path.dirname(note))
    configureNotes(notes)

    writeFileSync(note, 'v1 第一版\n')
    await service.autoCommit()
    writeFileSync(note, 'v2\n')
    await service.autoCommit()
    writeFileSync(path.join(notes, 'other.md'), 'unrelated')
    await service.autoCommit()
    writeFileSync(note, 'v3\n')
    await service.autoCommit()
    return { notes, note }
  }

  it('lists the commits that touched the file, newest first', async () => {
    const { notes, note } = await setUpHistory()

    const history = await service.getFileHistory(note)

    expect(history.map((entry) => git(notes, 'show', `${entry.hash}:sub dir/note.md`))).toEqual([
      'v3',
      'v2',
      'v1 第一版'
    ])
    expect(history[0].message).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(Number.isNaN(Date.parse(history[0].date))).toBe(false)
  })

  it('has no history before the first commit', async () => {
    const notes = makeDir('notes')
    writeFileSync(path.join(notes, 'a.md'), 'a')
    configureNotes(notes)

    expect(await service.getFileHistory(path.join(notes, 'a.md'))).toEqual([])
  })

  it('diffs a version against the file on disk', async () => {
    const { note } = await setUpHistory()
    const [, v2] = await service.getFileHistory(note)
    writeFileSync(note, 'unsaved\n')

    const { diff, truncated } = await service.getFileDiff(note, v2.hash)

    expect(truncated).toBe(false)
    expect(diff).toContain('-v2')
    expect(diff).toContain('+unsaved')
  })

  it('restores a version and keeps the replaced content in history', async () => {
    const { notes, note } = await setUpHistory()
    const history = await service.getFileHistory(note)
    const v1 = history[2]
    writeFileSync(note, 'not yet committed\n')

    await service.restoreFile(note, v1.hash)

    expect(readFileSync(note, 'utf8')).toBe('v1 第一版\n')
    expect(git(notes, 'show', 'HEAD:sub dir/note.md')).toBe('not yet committed')
    // History only grew: every earlier commit is still an ancestor of HEAD.
    for (const entry of history) {
      expect(() => git(notes, 'merge-base', '--is-ancestor', entry.hash, 'HEAD')).not.toThrow()
    }
  })

  it('refuses paths outside the notes folder and malformed revisions', async () => {
    const { notes, note } = await setUpHistory()
    const [latest] = await service.getFileHistory(note)
    const outside = path.join(sandbox, 'outside.md')
    writeFileSync(outside, 'keep')

    await expectIpcError(service.restoreFile(outside, latest.hash), notesErrorCodes.GIT_INVALID_PATH)
    await expectIpcError(
      service.restoreFile(path.join(notes, '.git', 'config'), latest.hash),
      notesErrorCodes.GIT_INVALID_PATH
    )
    await expectIpcError(service.restoreFile(note, '--output=/tmp/x'), notesErrorCodes.GIT_REVISION_NOT_FOUND)
    await expectIpcError(service.getFileDiff(note, 'HEAD~1'), notesErrorCodes.GIT_REVISION_NOT_FOUND)
    await expectIpcError(service.restoreFile(note, 'deadbeef'), notesErrorCodes.GIT_REVISION_NOT_FOUND)
    expect(readFileSync(outside, 'utf8')).toBe('keep')
    expect(readFileSync(note, 'utf8')).toBe('v3\n')
  })

  it('refuses to restore while a merge is in progress', async () => {
    const { notes, note } = await setUpHistory()
    const [, v2] = await service.getFileHistory(note)
    writeFileSync(path.join(notes, '.git', 'MERGE_HEAD'), `${v2.hash}\n`)

    await expectIpcError(service.restoreFile(note, v2.hash), notesErrorCodes.GIT_REPOSITORY_BUSY)
    expect(readFileSync(note, 'utf8')).toBe('v3\n')
  })
})
