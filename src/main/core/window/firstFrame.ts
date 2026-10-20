import type { BrowserWindow } from 'electron'

import { loggerService } from '@logger'

const logger = loggerService.withContext('WindowFirstFrame')

/**
 * Upper bound on how long a reveal waits for the renderer's first-frame report. It only covers a
 * renderer that never reports (crash, failed load, a UI that does not call `useReportFirstFrame`):
 * the window is shown anyway rather than staying hidden forever.
 */
export const FIRST_FRAME_TIMEOUT_MS = 3000

/** Reveals waiting on each WindowManager window whose UI has not reported its first frame yet. */
const pendingReveals = new WeakMap<BrowserWindow, Set<() => void>>()

/**
 * Start tracking a freshly constructed window. WindowManager calls this for every window it
 * creates, before content starts loading, so the first-frame report cannot be missed.
 */
export function trackFirstFrame(window: BrowserWindow): void {
  pendingReveals.set(window, new Set())
}

/**
 * Record that `window`'s UI has rendered its first frame (its renderer's `window.report_first_frame`
 * request) and run the reveals waiting for it. Later reports are no-ops.
 */
export function markFirstFrame(window: BrowserWindow): void {
  const reveals = pendingReveals.get(window)
  if (!reveals) return
  pendingReveals.delete(window)
  for (const reveal of reveals) reveal()
}

/** Whether `window` was created by WindowManager and its UI has not reported a first frame yet. */
export function isAwaitingFirstFrame(window: BrowserWindow): boolean {
  return pendingReveals.has(window)
}

/**
 * Run `reveal` once `window`'s UI has rendered its first frame, so a window created on demand
 * appears with its content instead of as a blank frame while its renderer starts.
 *
 * - Already rendered (a recycled pool window, a live singleton): `reveal` runs synchronously and
 *   `null` is returned.
 * - Still loading: `reveal` runs on the first-frame report, or after {@link FIRST_FRAME_TIMEOUT_MS}
 *   (from then on the window counts as rendered). Returns a function that cancels the pending
 *   reveal. A window destroyed in the meantime is never revealed.
 *
 * The window's renderer must call `useReportFirstFrame`, and the window must keep
 * `paintWhenInitiallyHidden` at Electron's default (`true`): a hidden window that may not paint
 * runs no animation frames, so its report never comes and it only appears after the timeout.
 */
export function revealOnFirstFrame(window: BrowserWindow, reveal: () => void): (() => void) | null {
  const reveals = pendingReveals.get(window)
  if (!reveals) {
    reveal()
    return null
  }

  const onFirstFrame = () => {
    clearTimeout(timer)
    if (!window.isDestroyed()) reveal()
  }
  const timer = setTimeout(() => {
    if (window.isDestroyed()) return
    logger.warn('Window did not report its first frame in time, revealing it anyway', {
      timeoutMs: FIRST_FRAME_TIMEOUT_MS
    })
    markFirstFrame(window)
  }, FIRST_FRAME_TIMEOUT_MS)
  reveals.add(onFirstFrame)

  return () => {
    clearTimeout(timer)
    reveals.delete(onFirstFrame)
  }
}
