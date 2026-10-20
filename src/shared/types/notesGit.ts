/**
 * Git versioning of the notes folder (fork feature, ported from the v1 fork's NotesGitService).
 * Main owns the repository; the renderer only asks for status, history, diffs and restores.
 */

/** Auto-commit delays offered in settings, in minutes (v1 fork values). */
export const NOTES_GIT_COMMIT_INTERVAL_OPTIONS = [1, 5, 10, 30, 60] as const

export type NotesGitUnavailableReason =
  | 'disabled'
  | 'notes_path_missing'
  | 'notes_path_invalid'
  | 'git_not_found'
  /** The notes folder sits inside another repository; Cherry Studio never creates a repo inside it. */
  | 'nested_repository'
  /** A repository exists but git cannot read it (corrupt, ownership check, …); it is left alone. */
  | 'repository_error'

export type NotesGitStatus =
  /** `repository: 'none'` means the first auto-commit will create one. */
  { available: true; repository: 'none' | 'existing' } | { available: false; reason: NotesGitUnavailableReason }

export interface NotesGitCommit {
  hash: string
  /** Author date, strict ISO 8601. */
  date: string
  message: string
}

export interface NotesGitFileDiff {
  /** Unified diff from the commit to the current file on disk; empty when identical. */
  diff: string
  truncated: boolean
}
