import { notesGitService } from '@main/services/NotesGitService'
import type { notesRequestSchemas } from '@shared/ipc/schemas/notes'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapter over `NotesGitService`; acts on the notes folder, not the caller's window. */
export const notesHandlers: IpcHandlersFor<typeof notesRequestSchemas> = {
  'notes.git.get_status': () => notesGitService.getStatus(),
  'notes.git.auto_commit': () => notesGitService.autoCommit(),
  'notes.git.get_file_history': ({ path }) => notesGitService.getFileHistory(path),
  'notes.git.get_file_diff': ({ path, revision }) => notesGitService.getFileDiff(path, revision),
  'notes.git.restore_file': ({ path, revision }) => notesGitService.restoreFile(path, revision)
}
