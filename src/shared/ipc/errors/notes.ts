/** Notes git versioning failures (`notes.git.*` routes). */
export const notesErrorCodes = {
  /** Versioning is off or cannot run; `data.reason` is a `NotesGitUnavailableReason`. */
  GIT_UNAVAILABLE: 'NOTES_GIT_UNAVAILABLE',
  /** The path is not a file inside the notes folder. */
  GIT_INVALID_PATH: 'NOTES_GIT_INVALID_PATH',
  /** The revision is malformed, unknown, or does not contain the file. */
  GIT_REVISION_NOT_FOUND: 'NOTES_GIT_REVISION_NOT_FOUND',
  /** A merge/rebase/… is in progress in the notes repository. */
  GIT_REPOSITORY_BUSY: 'NOTES_GIT_REPOSITORY_BUSY',
  GIT_COMMAND_FAILED: 'NOTES_GIT_COMMAND_FAILED'
} as const
