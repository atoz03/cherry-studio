import { NOTES_GIT_COMMIT_INTERVAL_OPTIONS } from '@shared/types/notesGit'

import type { TransformResult } from './ComplexPreferenceMappings'

/**
 * v1 fork notes-git settings (`note.settings.enableGit` / `gitCommitIntervalMinutes`) → v2
 * preferences. Values v1 could not have written are dropped so the v2 defaults apply.
 */
export function transformNotesGitSettings(sources: Record<string, unknown>): TransformResult {
  const result: TransformResult = {}
  if (typeof sources.enableGit === 'boolean') {
    result['feature.notes.git.enabled'] = sources.enableGit
  }
  const interval = sources.commitIntervalMinutes
  if (NOTES_GIT_COMMIT_INTERVAL_OPTIONS.some((option) => option === interval)) {
    result['feature.notes.git.commit_interval_minutes'] = interval
  }
  return result
}
