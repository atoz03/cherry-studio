import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const originalGetSystemVersion = process.getSystemVersion

async function loadWindowUtil({ isWin, systemVersion = '' }: { isWin: boolean; systemVersion?: string }) {
  vi.resetModules()
  vi.doMock('@main/core/platform', () => ({
    isDev: false,
    isWin
  }))

  const getSystemVersionMock = vi.fn(() => systemVersion)
  Object.defineProperty(process, 'getSystemVersion', {
    value: getSystemVersionMock,
    configurable: true
  })

  const windowUtil = await import('../windowUtil')
  return { ...windowUtil }
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.doUnmock('@main/core/platform')

  Object.defineProperty(process, 'getSystemVersion', {
    value: originalGetSystemVersion,
    configurable: true
  })
})

describe('getWindowsBackgroundMaterial', () => {
  it('returns mica on Windows 11 22H2 and newer', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: true,
      systemVersion: '10.0.22621'
    })

    expect(getWindowsBackgroundMaterial()).toBe('mica')
  })

  it('returns undefined below the Windows 11 22H2 build threshold', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: true,
      systemVersion: '10.0.22000'
    })

    expect(getWindowsBackgroundMaterial()).toBeUndefined()
  })

  it('returns undefined when the system version cannot be parsed', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: true,
      systemVersion: 'Windows 11'
    })

    expect(getWindowsBackgroundMaterial()).toBeUndefined()
  })

  it('returns undefined on non-Windows platforms', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: false,
      systemVersion: '10.0.22621'
    })

    expect(getWindowsBackgroundMaterial()).toBeUndefined()
  })
})

describe('throttleWhileHidden', () => {
  /** A window that records whether throttling was allowed at the moment it went hidden. */
  function fakeWindow() {
    const state = { throttling: false, hiddenWhileThrottled: [] as boolean[] }
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      webContents: { setBackgroundThrottling: (allowed: boolean) => (state.throttling = allowed) },
      hide: () => state.hiddenWhileThrottled.push(state.throttling),
      minimize: () => state.hiddenWhileThrottled.push(state.throttling)
    })
    return { window, state }
  }

  // Electron ignores the flag for a window that is already hidden, so it must be on before hide.
  it('allows throttling before the window hides or minimizes', async () => {
    const { throttleWhileHidden } = await loadWindowUtil({ isWin: false })
    const { window, state } = fakeWindow()
    throttleWhileHidden(window as never, () => true)

    window.hide()
    window.emit('show')
    window.minimize()

    expect(state.hiddenWhileThrottled).toEqual([true, true])
  })

  it('lifts throttling once the window is visible again', async () => {
    const { throttleWhileHidden } = await loadWindowUtil({ isWin: false })
    const { window, state } = fakeWindow()
    throttleWhileHidden(window as never, () => true)

    window.emit('minimize')
    expect(state.throttling).toBe(true)
    window.emit('restore')
    expect(state.throttling).toBe(false)
  })

  it('never throttles when the user turned the switch off', async () => {
    const { throttleWhileHidden } = await loadWindowUtil({ isWin: false })
    const { window, state } = fakeWindow()
    throttleWhileHidden(window as never, () => false)

    window.hide()
    window.emit('minimize')

    expect(state.hiddenWhileThrottled).toEqual([false])
    expect(state.throttling).toBe(false)
  })
})
