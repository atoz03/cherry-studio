import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HiddenPageUnloader } from '../HiddenPageUnloader'

const MINUTE = 60_000

describe('HiddenPageUnloader', () => {
  let unloader: HiddenPageUnloader

  beforeEach(() => {
    vi.useFakeTimers()
    unloader = new HiddenPageUnloader()
    unloader.setTimeoutMinutes(1)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('unloads a page once it stayed hidden for the whole timeout', () => {
    const unload = vi.fn()
    unloader.hide('a', unload)

    vi.advanceTimersByTime(MINUTE - 1)
    expect(unload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(unload).toHaveBeenCalledTimes(1)
  })

  it('keeps a page that was shown again before the timeout', () => {
    const unload = vi.fn()
    unloader.hide('a', unload)
    vi.advanceTimersByTime(MINUTE / 2)
    unloader.show('a')

    vi.advanceTimersByTime(10 * MINUTE)
    expect(unload).not.toHaveBeenCalled()
  })

  // Owners re-report hidden pages on every render; that must not restart the clock forever.
  it('keeps the original hidden time when a hidden page is reported again', () => {
    const unload = vi.fn()
    unloader.hide('a', unload)
    vi.advanceTimersByTime(MINUTE / 2)
    unloader.hide('a', unload)

    vi.advanceTimersByTime(MINUTE / 2)
    expect(unload).toHaveBeenCalledTimes(1)
  })

  it('keeps a busy page and unloads it a full timeout after it is idle', () => {
    let busy = true
    const unload = vi.fn()
    unloader.hide('a', unload, () => busy)

    vi.advanceTimersByTime(MINUTE)
    expect(unload).not.toHaveBeenCalled()
    busy = false
    vi.advanceTimersByTime(MINUTE)
    expect(unload).toHaveBeenCalledTimes(1)
  })

  it('keeps hidden pages loaded and arms no timer when the timeout is 0', () => {
    const unload = vi.fn()
    unloader.setTimeoutMinutes(0)
    unloader.hide('a', unload)

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60 * MINUTE)
    expect(unload).not.toHaveBeenCalled()
  })

  it('arms no timer while nothing is hidden', () => {
    unloader.hide('a', vi.fn())
    unloader.show('a')

    expect(vi.getTimerCount()).toBe(0)
  })
})
