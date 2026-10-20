import { useCallback, useEffect, useRef } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('useNotesGitAutoCommit')

const commit = () => {
  ipcApi.request('notes.git.auto_commit').catch((error) => {
    logger.warn('Notes auto-commit failed', error as Error)
  })
}

/**
 * Auto-commit the notes folder while the notes page is mounted (v1 fork behaviour, scoped to the
 * page): once on open for changes made elsewhere, `intervalMinutes` after the first change
 * reported through `markChanged`, and once more on close if a commit is still pending. A timer
 * exists only between a change and its commit, and never while versioning is off.
 */
export function useNotesGitAutoCommit(notesPath: string | undefined): { markChanged: () => void } {
  const [enabled] = usePreference('feature.notes.git.enabled')
  const [intervalMinutes] = usePreference('feature.notes.git.commit_interval_minutes')
  const active = Boolean(enabled && notesPath)
  const intervalRef = useRef(intervalMinutes)
  const markChangedRef = useRef<() => void>(() => {})

  useEffect(() => {
    intervalRef.current = intervalMinutes
  }, [intervalMinutes])

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | null = null
    commit()
    markChangedRef.current = () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        commit()
      }, intervalRef.current * 60_000)
    }
    return () => {
      markChangedRef.current = () => {}
      if (timer === null) return
      clearTimeout(timer)
      commit()
    }
  }, [active, notesPath])

  const markChanged = useCallback(() => markChangedRef.current(), [])
  return { markChanged }
}
