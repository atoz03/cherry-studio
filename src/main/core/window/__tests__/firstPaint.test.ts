import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FIRST_PAINT_REVEAL_TIMEOUT_MS, isAwaitingFirstPaint, revealWhenPainted, trackFirstPaint } from '../firstPaint'

/** Minimal BrowserWindow stand-in: real event semantics plus a toggleable destroyed flag. */
function createWindow() {
  const emitter = new EventEmitter() as EventEmitter & { destroyed: boolean; isDestroyed: () => boolean }
  emitter.destroyed = false
  emitter.isDestroyed = () => emitter.destroyed
  return emitter
}

const asWindow = (w: ReturnType<typeof createWindow>) => w as unknown as BrowserWindow

describe('firstPaint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals a window that is not awaiting its first paint synchronously', () => {
    const win = createWindow()
    const reveal = vi.fn()

    expect(revealWhenPainted(asWindow(win), reveal)).toBeNull()
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('holds a freshly created window back until its first ready-to-show', () => {
    const win = createWindow()
    trackFirstPaint(asWindow(win))
    const reveal = vi.fn()

    expect(isAwaitingFirstPaint(asWindow(win))).toBe(true)
    expect(revealWhenPainted(asWindow(win), reveal)).toEqual(expect.any(Function))
    expect(reveal).not.toHaveBeenCalled()

    win.emit('ready-to-show')

    expect(reveal).toHaveBeenCalledTimes(1)
    expect(isAwaitingFirstPaint(asWindow(win))).toBe(false)

    // Painted from now on: later reveals are immediate, and the timeout never fires a second reveal.
    const later = vi.fn()
    expect(revealWhenPainted(asWindow(win), later)).toBeNull()
    expect(later).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(FIRST_PAINT_REVEAL_TIMEOUT_MS)
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('reveals every pending caller on the same first paint', () => {
    const win = createWindow()
    trackFirstPaint(asWindow(win))
    const first = vi.fn()
    const second = vi.fn()

    revealWhenPainted(asWindow(win), first)
    revealWhenPainted(asWindow(win), second)
    win.emit('ready-to-show')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('never reveals after the caller cancels', () => {
    const win = createWindow()
    trackFirstPaint(asWindow(win))
    const reveal = vi.fn()

    const cancel = revealWhenPainted(asWindow(win), reveal)
    cancel?.()
    win.emit('ready-to-show')
    vi.advanceTimersByTime(FIRST_PAINT_REVEAL_TIMEOUT_MS)

    expect(reveal).not.toHaveBeenCalled()
    expect(win.listenerCount('closed')).toBe(0)
  })

  it('never reveals a window closed before it painted', () => {
    const win = createWindow()
    trackFirstPaint(asWindow(win))
    const reveal = vi.fn()

    revealWhenPainted(asWindow(win), reveal)
    win.destroyed = true
    win.emit('closed')
    vi.advanceTimersByTime(FIRST_PAINT_REVEAL_TIMEOUT_MS)

    expect(reveal).not.toHaveBeenCalled()
  })

  it('does not reveal a window destroyed by the time ready-to-show fires', () => {
    const win = createWindow()
    trackFirstPaint(asWindow(win))
    const reveal = vi.fn()

    revealWhenPainted(asWindow(win), reveal)
    win.destroyed = true
    win.emit('ready-to-show')

    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals anyway when the renderer never paints, then stops waiting for that window', () => {
    const win = createWindow()
    trackFirstPaint(asWindow(win))
    const reveal = vi.fn()

    revealWhenPainted(asWindow(win), reveal)
    vi.advanceTimersByTime(FIRST_PAINT_REVEAL_TIMEOUT_MS - 1)
    expect(reveal).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(isAwaitingFirstPaint(asWindow(win))).toBe(false)

    // A late ready-to-show must not reveal a second time.
    win.emit('ready-to-show')
    expect(reveal).toHaveBeenCalledTimes(1)
  })
})
