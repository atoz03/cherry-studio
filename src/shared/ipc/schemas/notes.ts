import * as z from 'zod'

import type { NotesGitCommit, NotesGitFileDiff, NotesGitStatus } from '../../types/notesGit'
import { defineRoute } from '../define'

const NoteFileInput = z.strictObject({ path: z.string().min(1) })
const NoteRevisionInput = NoteFileInput.extend({ revision: z.string().min(1).max(64) })

/** Git versioning of the notes folder; main resolves the folder from `feature.notes.path`. */
export const notesRequestSchemas = {
  'notes.git.get_status': defineRoute({
    input: z.void(),
    output: z.union([
      z.strictObject({ available: z.literal(true), repository: z.enum(['none', 'existing']) }),
      z.strictObject({
        available: z.literal(false),
        reason: z.enum([
          'disabled',
          'notes_path_missing',
          'notes_path_invalid',
          'git_not_found',
          'nested_repository',
          'repository_error'
        ])
      })
    ]) satisfies z.ZodType<NotesGitStatus>
  }),
  'notes.git.auto_commit': defineRoute({
    input: z.void(),
    output: z.strictObject({ committed: z.boolean() })
  }),
  'notes.git.get_file_history': defineRoute({
    input: NoteFileInput,
    output: z.array(z.strictObject({ hash: z.string(), date: z.string(), message: z.string() })) satisfies z.ZodType<
      NotesGitCommit[]
    >
  }),
  'notes.git.get_file_diff': defineRoute({
    input: NoteRevisionInput,
    output: z.strictObject({ diff: z.string(), truncated: z.boolean() }) satisfies z.ZodType<NotesGitFileDiff>
  }),
  'notes.git.restore_file': defineRoute({
    input: NoteRevisionInput,
    output: z.void()
  })
}
