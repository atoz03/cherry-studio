import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../../lifecycle/BaseService'

/**
 * WindowManager driven by the shipped WINDOW_TYPE_REGISTRY (not a fixture registry), so these
 * tests pin what the real window types cost: which renderers exist after boot, and how the
 * on-demand types are created and torn down.
 */

const { createdWindows } = vi.hoisted(() => ({ createdWindows: [] as unknown[] }))

vi.mock('@main/core/platform', () => ({ isMac: false, isWin: false, isLinux: false, isDev: false }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')

  class BrowserWindowMock extends EventEmitter {
    private destroyed = false
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      isCrashed: vi.fn(() => false),
      getURL: vi.fn(() => ''),
      setZoomFactor: vi.fn(),
      mainFrame: { frameTreeNodeId: 1 }
    }
    show = vi.fn()
    showInactive = vi.fn()
    hide = vi.fn()
    focus = vi.fn()
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    loadFile = vi.fn(() => Promise.resolve())
    loadURL = vi.fn(() => Promise.resolve())
    isVisible = vi.fn(() => false)
    isFullScreen = vi.fn(() => false)
    isMaximized = vi.fn(() => false)
    isMinimized = vi.fn(() => false)
    setBounds = vi.fn()
    setContentBounds = vi.fn()
    isDestroyed = vi.fn(() => this.destroyed)
    destroy = vi.fn(() => {
      if (this.destroyed) return
      this.destroyed = true
      this.emit('closed')
    })

    constructor() {
      super()
      createdWindows.push(this)
    }
  }

  return {
    app: { dock: { show: () => Promise.resolve(), hide: () => {} } },
    BrowserWindow: BrowserWindowMock,
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getDisplayNearestPoint: vi.fn(() => ({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 }
      }))
    }
  }
})

const { WindowManager } = await import('../WindowManager')
const { WindowType } = await import('../types')

/** Let deferred work (setImmediate standby replenishes) run. */
const flushImmediate = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('WindowManager with the shipped window registry', () => {
  let wm: InstanceType<typeof WindowManager>

  beforeEach(async () => {
    BaseService.resetInstances()
    createdWindows.length = 0
    wm = new WindowManager()
    await wm._doInit()
  })

  afterEach(async () => {
    await wm._doDestroy()
    await flushImmediate()
    BaseService.resetInstances()
  })

  it('creates no window at boot: every pooled or singleton type is built on first use', async () => {
    ;(wm as unknown as { onAllReady(): void }).onAllReady()
    await flushImmediate()

    expect(createdWindows).toHaveLength(0)
  })

  it('creates a fresh SubWindow per open, destroys it on close, and keeps no spare', async () => {
    const firstId = wm.open(WindowType.SubWindow)
    const first = wm.getWindow(firstId) as BrowserWindow
    await flushImmediate()
    // Only the requested window exists — no hidden standby is replenished behind it.
    expect(createdWindows).toHaveLength(1)

    expect(wm.close(firstId)).toBe(true)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(wm.getWindow(firstId)).toBeUndefined()

    // The next open never hands back the closed window (the SubWindow renderer is single-init).
    const secondId = wm.open(WindowType.SubWindow)
    expect(secondId).not.toBe(firstId)
    expect(wm.getWindow(secondId)).not.toBe(first)
    await flushImmediate()
    expect(createdWindows).toHaveLength(2)
  })

  it('leaves the first show of a SubWindow to its owner', () => {
    const id = wm.open(WindowType.SubWindow)
    const window = wm.getWindow(id) as BrowserWindow

    window.emit('ready-to-show')

    expect(window.show).not.toHaveBeenCalled()
  })

  it('builds the first SelectionAction on demand and recycles it instead of keeping a standby', async () => {
    const firstId = wm.open(WindowType.SelectionAction)
    const first = wm.getWindow(firstId) as BrowserWindow
    await flushImmediate()
    expect(createdWindows).toHaveLength(1)

    wm.close(firstId)
    expect(first.destroy).not.toHaveBeenCalled()
    expect(first.hide).toHaveBeenCalled()

    // The next action reuses the painted window instead of building a new renderer.
    expect(wm.open(WindowType.SelectionAction)).toBe(firstId)
    await flushImmediate()
    expect(createdWindows).toHaveLength(1)
  })
})
