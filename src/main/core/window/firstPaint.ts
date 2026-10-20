import type { BrowserWindow } from 'electron'

import { loggerService } from '@logger'

const logger = loggerService.withContext('WindowFirstPaint')

/**
 * Upper bound on how long a reveal waits for `ready-to-show`. With `paintWhenInitiallyHidden`
 * left at Electron's default (`true`) a hidden window still paints and fires the event, so this
 * only covers a renderer that never paints (crash, failed load): the window is shown anyway rather
 * than staying hidden forever. Long enough that a slow cold start still paints first.
 */
export const FIRST_PAINT_REVEAL_TIMEOUT_MS = 3000

/** WindowManager windows whose first `ready-to-show` has not fired yet. */
const awaitingFirstPaint = new WeakSet<BrowserWindow>()

/**
 * Start tracking a freshly constructed window. WindowManager calls this for every window it
 * creates, before content starts loading, so the first `ready-to-show` cannot be missed.
 */
export function trackFirstPaint(window: BrowserWindow): void {
  awaitingFirstPaint.add(window)
  window.once('ready-to-show', () => awaitingFirstPaint.delete(window))
}

/** Whether `window` was created by WindowManager and has not painted its first frame yet. */
export function isAwaitingFirstPaint(window: BrowserWindow): boolean {
  return awaitingFirstPaint.has(window)
}

/**
 * Run `reveal` once `window` has painted its first frame, instead of showing a window whose renderer
 * is still starting. `ready-to-show` marks the document's first paint, not the UI's: an entry that
 * awaits `prepareWindow()` before mounting React still shows only its background for a moment
 * (about 0.1–0.2 s on Linux) after the reveal.
 *
 * - Already painted (a recycled pool window, a long-lived singleton): `reveal` runs synchronously
 *   and `null` is returned.
 * - Still loading: `reveal` runs on the first `ready-to-show`, or after
 *   {@link FIRST_PAINT_REVEAL_TIMEOUT_MS} if the renderer never paints. Returns a function that
 *   cancels the pending reveal. A window destroyed in the meantime is never revealed.
 */
export function revealWhenPainted(window: BrowserWindow, reveal: () => void): (() => void) | null {
  if (!awaitingFirstPaint.has(window)) {
    reveal()
    return null
  }

  let settled = false

  const settle = (): boolean => {
    if (settled) return false
    settled = true
    clearTimeout(timer)
    window.removeListener('ready-to-show', onPainted)
    window.removeListener('closed', cancel)
    return true
  }
  const onPainted = () => {
    if (settle() && !window.isDestroyed()) reveal()
  }
  const cancel = () => {
    settle()
  }

  const timer = setTimeout(() => {
    if (!settle() || window.isDestroyed()) return
    logger.warn('Window did not paint in time, revealing it anyway', { timeoutMs: FIRST_PAINT_REVEAL_TIMEOUT_MS })
    // Stop treating it as unpainted, so later reveals do not wait for the timeout again.
    awaitingFirstPaint.delete(window)
    reveal()
  }, FIRST_PAINT_REVEAL_TIMEOUT_MS)

  window.once('ready-to-show', onPainted)
  window.once('closed', cancel)
  return cancel
}
