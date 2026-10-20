import type { UpdateInfo } from 'builder-util-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { updaterModule, autoUpdaterMock, readOnlyCheckMock, readOnlyUpdaters, scheduler, trackAppUpdateMock } =
  vi.hoisted(() => {
    const armed = new Set<string>()
    return {
      // Flips when the service first imports electron-updater.
      updaterModule: { loaded: false },
      autoUpdaterMock: {
        on: vi.fn(),
        removeListener: vi.fn(),
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn()
      } as Record<string, any>,
      readOnlyCheckMock: vi.fn(),
      readOnlyUpdaters: [] as Array<Record<string, unknown>>,
      trackAppUpdateMock: vi.fn(),
      // Minimal SchedulerService (scheduling itself: AppUpdaterService.scheduler.test.ts).
      scheduler: {
        armed,
        registerSchedule: vi.fn((id: string) => {
          armed.add(id)
          return { dispose: () => armed.delete(id) }
        }),
        unregister: vi.fn((id: string) => {
          armed.delete(id)
        })
      }
    }
  })

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'AnalyticsService') return { trackAppUpdate: trackAppUpdateMock }
    if (name === 'SchedulerService') return scheduler
    if (name === 'PowerService') return { registerShutdownHandler: vi.fn() }
    return originalGet(name)
  })
  return result
})

vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isWin: false
}))

vi.mock('electron-updater', () => {
  updaterModule.loaded = true

  // Starts as electron-updater does for a prerelease-tagged fork build (2.1.8-atoz.1).
  class MockAppUpdater {
    allowDowngrade = false
    allowPrerelease = true
    autoDownload = true
    autoInstallOnAppQuit = true
    channel: string | null = null
    forceDevUpdateConfig = false
    logger: unknown = null
    requestHeaders: Record<string, string> | null = null

    constructor() {
      readOnlyUpdaters.push(this as unknown as Record<string, unknown>)
    }

    checkForUpdates() {
      return readOnlyCheckMock()
    }
  }

  return { AppUpdater: MockAppUpdater, autoUpdater: autoUpdaterMock }
})

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app, net } from 'electron'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { AppUpdaterService } from '../AppUpdaterService'

const AUTO_CHECK_ID = 'app-updater:auto-check'
const forkFeedSettings = {
  allowPrerelease: false,
  allowDowngrade: false,
  channel: null,
  requestHeaders: { 'Cache-Control': 'no-cache' }
}

const setPackaged = (value: boolean) => {
  ;(app as { isPackaged: boolean }).isPackaged = value
}

async function startService(): Promise<AppUpdaterService> {
  const service = new AppUpdaterService()
  await service._doInit()
  await service._doAllReady()
  return service
}

describe('AppUpdaterService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.auto_update.enabled', true)
    setPackaged(true)
    vi.mocked(net.fetch).mockReset()
    vi.mocked(app.getVersion).mockReturnValue('2.1.8-atoz.1')
    scheduler.armed.clear()
    readOnlyCheckMock.mockReset().mockResolvedValue(null)
    readOnlyUpdaters.length = 0
    trackAppUpdateMock.mockReset()
    // electron-updater's defaults for a prerelease-tagged fork build (2.1.8-atoz.1).
    Object.assign(autoUpdaterMock, {
      allowDowngrade: false,
      allowPrerelease: true,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      channel: null,
      currentVersion: '2.1.8-atoz.1',
      forceDevUpdateConfig: false,
      logger: null,
      requestHeaders: null
    })
    autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null)
    autoUpdaterMock.downloadUpdate.mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    setPackaged(false)
  })

  describe('fork update feed', () => {
    it('does not load electron-updater until an update is checked', async () => {
      // Fresh module graph, so no earlier test has imported electron-updater yet.
      vi.resetModules()
      updaterModule.loaded = false
      const { AppUpdaterService: FreshAppUpdaterService } = await import('../AppUpdaterService')
      const service = new FreshAppUpdaterService()
      await service._doInit()
      await service._doAllReady()

      expect(scheduler.armed.has(AUTO_CHECK_ID)).toBe(true)
      expect(updaterModule.loaded).toBe(false)

      await service.checkForUpdates()

      expect(updaterModule.loaded).toBe(true)
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce()
    })

    it('checks the app updater against the fork releases without identifying headers or channel overrides', async () => {
      const service = await startService()

      await service.checkForUpdates()

      expect(autoUpdaterMock).toMatchObject({
        ...forkFeedSettings,
        autoDownload: true,
        autoInstallOnAppQuit: false,
        forceDevUpdateConfig: false
      })
    })

    it('reads the feed from the repository dev config in development builds', async () => {
      setPackaged(false)
      const service = await startService()

      await service.checkForUpdates()

      expect(autoUpdaterMock.forceDevUpdateConfig).toBe(true)
    })

    it('makes no requests of its own besides the updater feed', async () => {
      readOnlyCheckMock.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { releaseNotes: 'Fork notes', version: '2.1.8-atoz.2' }
      })
      const service = await startService()

      await service.checkForUpdates()
      await service.getReleaseHistory()
      await service.queryUpdateAvailability()

      expect(net.fetch).not.toHaveBeenCalled()
    })

    it('triggers the download itself when auto download is off', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.auto_update.enabled', false)
      autoUpdaterMock.checkForUpdates.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { version: '2.1.8-atoz.2' }
      })
      const service = await startService()

      await expect(service.checkForUpdates()).resolves.toMatchObject({ updateInfo: { version: '2.1.8-atoz.2' } })
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce()
    })

    it('stops downloading automatically once auto update is switched off', async () => {
      const service = await startService()
      await service.checkForUpdates()

      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.auto_update.enabled', false)

      expect(autoUpdaterMock.autoDownload).toBe(false)
    })

    it('reports a failed check through the return value instead of throwing', async () => {
      autoUpdaterMock.checkForUpdates.mockRejectedValue(new Error('offline'))
      const service = await startService()

      await expect(service.checkForUpdates()).resolves.toEqual({ currentVersion: '2.1.8-atoz.1', updateInfo: null })
    })
  })

  describe('read-only update query', () => {
    it('reports an available release from the same feed without using the app updater or analytics', async () => {
      readOnlyCheckMock.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '2.1.8-atoz.2' } })
      const service = new AppUpdaterService()

      await expect(service.queryUpdateAvailability()).resolves.toEqual({
        status: 'available',
        currentVersion: '2.1.8-atoz.1',
        version: '2.1.8-atoz.2'
      })
      expect(readOnlyUpdaters[0]).toMatchObject({
        ...forkFeedSettings,
        autoDownload: false,
        autoInstallOnAppQuit: false
      })
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(trackAppUpdateMock).not.toHaveBeenCalled()
    })

    it('does not turn a failed or unsupported updater query into an up-to-date result', async () => {
      const service = new AppUpdaterService()
      readOnlyCheckMock.mockRejectedValueOnce(new Error('HTTP 503'))
      await expect(service.queryUpdateAvailability()).rejects.toThrow('HTTP 503')
      readOnlyCheckMock.mockResolvedValueOnce(null)
      await expect(service.queryUpdateAvailability()).rejects.toThrow('did not produce a result')
    })
  })

  describe('release history', () => {
    it('returns the newer release the feed offers', async () => {
      readOnlyCheckMock.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { releaseNotes: 'Fork notes', version: '2.1.8-atoz.2' }
      })

      await expect(new AppUpdaterService().getReleaseHistory()).resolves.toEqual([
        { releaseNotes: 'Fork notes', version: '2.1.8-atoz.2' }
      ])
    })

    it.each([
      ['no newer release', async () => ({ isUpdateAvailable: false, updateInfo: { version: '2.1.8-atoz.1' } })],
      ['an offline feed', async () => Promise.reject(new Error('offline'))]
    ])('falls back to the bundled history for %s', async (_label, check) => {
      readOnlyCheckMock.mockImplementation(check)

      await expect(new AppUpdaterService().getReleaseHistory()).resolves.toBeNull()
    })
  })

  describe('processReleaseInfo', () => {
    const releaseInfo = (releaseNotes: UpdateInfo['releaseNotes']) =>
      ({
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes
      }) as UpdateInfo

    it('localizes marked release notes', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const result = (new AppUpdaterService() as any).processReleaseInfo(
        releaseInfo('<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->')
      )

      expect(result.releaseNotes).toBe('中文说明')
    })

    it.each([
      ['unmarked', 'Simple release notes'],
      [
        'array',
        [
          { version: '1.0.0', note: 'Note 1' },
          { version: '1.0.1', note: 'Note 2' }
        ]
      ],
      ['null', null]
    ])('leaves %s release notes unchanged', (_label, notes) => {
      expect((new AppUpdaterService() as any).processReleaseInfo(releaseInfo(notes)).releaseNotes).toEqual(notes)
    })

    it('leaves marked release notes unchanged when language lookup fails', () => {
      const info = releaseInfo('<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->')
      vi.mocked(application.get('PreferenceService').get).mockImplementationOnce(() => {
        throw new Error('Test error')
      })

      expect((new AppUpdaterService() as any).processReleaseInfo(info).releaseNotes).toBe(info.releaseNotes)
    })
  })
})
