import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIRST_FRAME_TIMEOUT_MS,
  isAwaitingFirstFrame,
  markFirstFrame,
  revealOnFirstFrame,
  trackFirstFrame
} from '../firstFrame'

/** Minimal BrowserWindow stand-in with a toggleable destroyed flag. */
function createWindow() {
  const win = { destroyed: false, isDestroyed: () => win.destroyed }
  return win
}

const asWindow = (w: ReturnType<typeof createWindow>) => w as unknown as BrowserWindow

describe('firstFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals a window that is not awaiting its first frame synchronously', () => {
    const win = createWindow()
    const reveal = vi.fn()

    expect(revealOnFirstFrame(asWindow(win), reveal)).toBeNull()
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('holds a freshly created window back until its UI reports a first frame', () => {
    const win = createWindow()
    trackFirstFrame(asWindow(win))
    const reveal = vi.fn()

    expect(isAwaitingFirstFrame(asWindow(win))).toBe(true)
    expect(revealOnFirstFrame(asWindow(win), reveal)).toEqual(expect.any(Function))
    expect(reveal).not.toHaveBeenCalled()

    markFirstFrame(asWindow(win))

    expect(reveal).toHaveBeenCalledTimes(1)
    expect(isAwaitingFirstFrame(asWindow(win))).toBe(false)

    // Rendered from now on: later reveals are immediate, and neither a repeated report nor the
    // timeout reveals a second time.
    const later = vi.fn()
    expect(revealOnFirstFrame(asWindow(win), later)).toBeNull()
    expect(later).toHaveBeenCalledTimes(1)
    markFirstFrame(asWindow(win))
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS)
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('reveals every pending caller on the same first frame', () => {
    const win = createWindow()
    trackFirstFrame(asWindow(win))
    const first = vi.fn()
    const second = vi.fn()

    revealOnFirstFrame(asWindow(win), first)
    revealOnFirstFrame(asWindow(win), second)
    markFirstFrame(asWindow(win))

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('never reveals after the caller cancels', () => {
    const win = createWindow()
    trackFirstFrame(asWindow(win))
    const reveal = vi.fn()

    const cancel = revealOnFirstFrame(asWindow(win), reveal)
    cancel?.()
    markFirstFrame(asWindow(win))
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS)

    expect(reveal).not.toHaveBeenCalled()
  })

  it('never reveals a window destroyed before its first frame', () => {
    const win = createWindow()
    trackFirstFrame(asWindow(win))
    const reveal = vi.fn()

    revealOnFirstFrame(asWindow(win), reveal)
    win.destroyed = true
    markFirstFrame(asWindow(win))
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS)

    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals anyway when the UI never reports, then stops waiting for that window', () => {
    const win = createWindow()
    trackFirstFrame(asWindow(win))
    const reveal = vi.fn()
    const alsoWaiting = vi.fn()

    revealOnFirstFrame(asWindow(win), reveal)
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS / 2)
    revealOnFirstFrame(asWindow(win), alsoWaiting)
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS / 2 - 1)
    expect(reveal).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(reveal).toHaveBeenCalledTimes(1)
    // A reveal queued later is not left waiting for its own timeout.
    expect(alsoWaiting).toHaveBeenCalledTimes(1)
    expect(isAwaitingFirstFrame(asWindow(win))).toBe(false)

    // A late report must not reveal a second time.
    markFirstFrame(asWindow(win))
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(alsoWaiting).toHaveBeenCalledTimes(1)
  })
})
