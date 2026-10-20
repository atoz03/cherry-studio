/**
 * Scheduler tests for AppUpdaterService — the auto update-check cadence that
 * was moved out of the renderer into the main process.
 *
 * Unlike the sibling `AppUpdaterService.test.ts` (which stubs the scheduler to
 * test the update feed), this suite runs the REAL `BaseService` + a REAL
 * `SchedulerService` with fake timers, mirroring `JobManager.smoke.test.ts`.
 * That is the only way to exercise the self-rescheduling `once` loop end to end:
 * jitter on success, exponential backoff on failure, preference gating, and
 * cleanup on stop.
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'

import { AppUpdaterService } from '../AppUpdaterService'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isWin: false }))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path')
  },
  // Real BaseService.ipcHandle calls ipcMain.handle, so the mock must provide it.
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: vi.fn()
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    forceDevUpdateConfig: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    requestHeaders: {},
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    channel: '',
    allowDowngrade: false,
    disableDifferentialDownload: false,
    currentVersion: '1.0.0'
  },
  Logger: vi.fn(),
  NsisUpdater: vi.fn(),
  AppUpdater: vi.fn()
}))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

// Must mirror the private constants in AppUpdaterService.ts.
const SCHEDULE_ID = 'app-updater:auto-check'
const INITIAL_DELAY = 5_000
const INTERVAL = 4 * 60 * 60 * 1000
const BACKOFF_FIRST = 5 * 60 * 1000

const setPackaged = (value: boolean) => {
  ;(app as unknown as { isPackaged: boolean }).isPackaged = value
}

describe('AppUpdaterService — auto update-check scheduling', () => {
  let scheduler: SchedulerService
  let appUpdater: AppUpdaterService
  let prefValues: Record<string, unknown>
  let prefHandlers: Record<string, (value: unknown) => void>

  const changePreference = (key: string, value: unknown) => {
    prefValues[key] = value
    prefHandlers[key]?.(value)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    setPackaged(true)

    prefValues = {
      'app.dist.auto_update.enabled': true,
      'app.language': 'en'
    }
    prefHandlers = {}
    const prefStub = {
      get: vi.fn((key: string) => prefValues[key]),
      // onAllReady follows the auto-update preference; return an unsubscribe fn.
      subscribeChange: vi.fn((key: string, handler: (value: unknown) => void) => {
        prefHandlers[key] = handler
        return () => delete prefHandlers[key]
      })
    }
    const powerStub = { registerShutdownHandler: vi.fn() }
    const analyticsStub = { trackAppUpdate: vi.fn() }
    const windowManagerStub = { broadcastToType: vi.fn() }

    scheduler = new SchedulerService()
    appUpdater = new AppUpdaterService()

    ;(application.get as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockImplementation((name: string) => {
      switch (name) {
        case 'PreferenceService':
          return prefStub
        case 'SchedulerService':
          return scheduler
        case 'PowerService':
          return powerStub
        case 'AnalyticsService':
          return analyticsStub
        case 'WindowManager':
          return windowManagerStub
        default:
          throw new Error(`unexpected application.get('${name}')`)
      }
    })

    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
    autoUpdater.requestHeaders = {}
    autoUpdater.channel = ''
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false
    // Center the jitter so the normal cadence is exactly CHECK_INTERVAL_MS.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await scheduler._doInit()
    await appUpdater._doInit()
  })

  afterEach(async () => {
    await appUpdater._doStop()
    await scheduler._doStop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    BaseService.resetInstances()
  })

  it('runs an initial check shortly after startup when packaged and enabled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('reschedules the next check ~4h after a success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('keeps no timer while disabled and starts checking once re-enabled', async () => {
    prefValues['app.dist.auto_update.enabled'] = false
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    expect(scheduler.has(SCHEDULE_ID)).toBe(false)
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY + INTERVAL)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    changePreference('app.dist.auto_update.enabled', true)
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('drops the timer when auto update is switched off, also after a check in flight', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(scheduler.has(SCHEDULE_ID)).toBe(true)

    changePreference('app.dist.auto_update.enabled', false)
    expect(scheduler.has(SCHEDULE_ID)).toBe(false)

    // A check that is running when the user switches auto update off must not re-arm.
    changePreference('app.dist.auto_update.enabled', true)
    let finishCheck: (value: null) => void = () => {}
    vi.mocked(autoUpdater.checkForUpdates).mockImplementation(() => new Promise((resolve) => (finishCheck = resolve)))
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    changePreference('app.dist.auto_update.enabled', false)
    finishCheck(null)
    await vi.advanceTimersByTimeAsync(0)

    expect(scheduler.has(SCHEDULE_ID)).toBe(false)
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('backs off after a failed check and recovers normal cadence after a success', async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('network'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1) // #1 failed → backoff 5min

    // Backoff (5min) is shorter than the 4h cadence; let #2 succeed.
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
    await vi.advanceTimersByTimeAsync(BACKOFF_FIRST)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    // After success the cadence resets to ~4h: another 5min must NOT fire a check.
    await vi.advanceTimersByTimeAsync(BACKOFF_FIRST)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL - BACKOFF_FIRST)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('does not schedule when the app is not packaged', async () => {
    setPackaged(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    expect(scheduler.has(SCHEDULE_ID)).toBe(false)
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY + INTERVAL)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('unregisters the schedule on stop and stops checking', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(scheduler.has(SCHEDULE_ID)).toBe(true)

    await appUpdater._doStop()
    expect(scheduler.has(SCHEDULE_ID)).toBe(false)

    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
