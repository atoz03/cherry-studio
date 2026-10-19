import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { platform, electronMock, wmMock, createdListeners } = vi.hoisted(() => {
  const platform = { isMac: false, isWin: false }
  const electronMock = {
    getFocusedWindow: vi.fn<() => unknown>(() => null)
  }
  const createdListeners: Array<(managed: { id: string; window: unknown }) => void> = []
  const wmMock = {
    open: vi.fn<(type: string) => string>(),
    getWindow: vi.fn<(id: string) => unknown>(),
    close: vi.fn<(id: string) => boolean>(() => true),
    onWindowCreatedByType: vi.fn((_type: string, listener: (managed: { id: string; window: unknown }) => void) => {
      createdListeners.push(listener)
      return { dispose: vi.fn() }
    })
  }
  return { platform, electronMock, wmMock, createdListeners }
})

vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platform.isMac
  },
  get isWin() {
    return platform.isWin
  },
  isLinux: false,
  isDev: false
}))

vi.mock('electron', () => ({
  app: { hide: vi.fn() },
  BrowserWindow: { getFocusedWindow: electronMock.getFocusedWindow },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }))
  }
}))

vi.mock('@application', async () => {
  const { defaultServiceInstances, mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    WindowManager: wmMock,
    MainWindowService: {
      ...defaultServiceInstances.MainWindowService,
      onMainWindowCreated: vi.fn(() => ({ dispose: vi.fn() }))
    }
  })
})

import { BaseService } from '@main/core/lifecycle/BaseService'
import { trackFirstPaint } from '@main/core/window/firstPaint'
import { WindowType } from '@main/core/window/types'

import { QuickAssistantService } from '../QuickAssistantService'

type MockQuickWindow = EventEmitter & {
  id: number
  visible: boolean
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

let createdWindows: MockQuickWindow[] = []

/** Stand-in for a freshly constructed BrowserWindow, as WindowManager.open() returns it. */
function createQuickWindow(id: number): MockQuickWindow {
  const win = new EventEmitter() as MockQuickWindow
  win.id = id
  win.visible = false
  win.show = vi.fn(() => {
    win.visible = true
    win.emit('show')
  })
  win.hide = vi.fn(() => {
    win.visible = false
    win.emit('hide')
  })
  win.focus = vi.fn()
  Object.assign(win, {
    isDestroyed: () => false,
    isVisible: () => win.visible,
    isMinimized: () => false,
    isFocused: () => win.visible,
    setOpacity: vi.fn(),
    getBounds: () => ({ x: 0, y: 0, width: 550, height: 400 }),
    setPosition: vi.fn(),
    setBounds: vi.fn(),
    webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() }
  })
  return win
}

describe('QuickAssistantService — on-demand window', () => {
  let svc: QuickAssistantService

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    platform.isMac = false
    platform.isWin = false
    createdWindows = []
    createdListeners.length = 0
    electronMock.getFocusedWindow.mockReturnValue(null)

    // WindowManager.open(): construct, notify onWindowCreatedByType subscribers, track first paint.
    wmMock.open.mockImplementation(() => {
      const win = createQuickWindow(100 + createdWindows.length)
      createdWindows.push(win)
      const id = `qa-${createdWindows.length}`
      for (const listener of createdListeners) listener({ id, window: win })
      trackFirstPaint(win as unknown as BrowserWindow)
      return id
    })
    wmMock.getWindow.mockImplementation((id) => createdWindows[Number(id.split('-')[1]) - 1])

    svc = new QuickAssistantService()
    await svc._doInit()
  })

  afterEach(async () => {
    await svc._doDestroy()
    BaseService.resetInstances()
  })

  it('creates no window when the feature is activated', async () => {
    expect(await svc._doActivate()).toBe(true)

    expect(wmMock.open).not.toHaveBeenCalled()
  })

  it('does nothing while the feature is disabled', () => {
    svc.showQuickAssistant()

    expect(wmMock.open).not.toHaveBeenCalled()
  })

  it('creates the window on the first show and shows it only after its first paint', async () => {
    await svc._doActivate()

    svc.showQuickAssistant()

    expect(wmMock.open).toHaveBeenCalledExactlyOnceWith(WindowType.QuickAssistant)
    const [win] = createdWindows
    expect(win.show).not.toHaveBeenCalled()

    win.emit('ready-to-show')

    expect(win.show).toHaveBeenCalledTimes(1)
  })

  it('shows once for repeated requests made while the new window is still loading', async () => {
    await svc._doActivate()

    svc.showQuickAssistant()
    svc.toggleQuickAssistant()
    svc.showQuickAssistant()
    createdWindows[0].emit('ready-to-show')

    expect(wmMock.open).toHaveBeenCalledTimes(1)
    expect(createdWindows[0].show).toHaveBeenCalledTimes(1)
  })

  it('reuses the window and shows it immediately on later requests', async () => {
    await svc._doActivate()
    svc.showQuickAssistant()
    const [win] = createdWindows
    win.emit('ready-to-show')
    svc.closeQuickAssistant()
    win.show.mockClear()

    svc.showQuickAssistant()

    expect(wmMock.open).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
  })

  it('drops the pending first show when the window is closed before it painted', async () => {
    await svc._doActivate()
    svc.showQuickAssistant()

    svc.closeQuickAssistant()
    createdWindows[0].emit('ready-to-show')

    expect(createdWindows[0].show).not.toHaveBeenCalled()
  })

  it('destroys the window on deactivate, without showing a still-pending first show', async () => {
    await svc._doActivate()
    svc.showQuickAssistant()

    await svc._doDeactivate()
    createdWindows[0].emit('ready-to-show')

    expect(wmMock.close).toHaveBeenCalledWith('qa-1')
    expect(createdWindows[0].show).not.toHaveBeenCalled()
  })

  it('stays usable when creating the window fails, and retries on the next show', async () => {
    await svc._doActivate()
    const open = wmMock.open.getMockImplementation()!
    wmMock.open.mockImplementationOnce(() => {
      throw new Error('renderer unavailable')
    })

    expect(() => svc.showQuickAssistant()).not.toThrow()

    wmMock.open.mockImplementation(open)
    svc.showQuickAssistant()
    createdWindows[0].emit('ready-to-show')

    expect(createdWindows[0].show).toHaveBeenCalledTimes(1)
  })

  it('[macOS] hands focus back to the previously focused window after creating the panel', async () => {
    platform.isMac = true
    const mainWindow = { id: 1, isDestroyed: () => false, focus: vi.fn() }
    electronMock.getFocusedWindow.mockReturnValue(mainWindow)
    await svc._doActivate()

    svc.showQuickAssistant()

    expect(mainWindow.focus).toHaveBeenCalledTimes(1)
  })
})
