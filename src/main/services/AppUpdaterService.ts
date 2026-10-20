import type { ProgressInfo, UpdateInfo } from 'builder-util-runtime'
import { app } from 'electron'
import type { AppUpdater, Logger, NsisUpdater } from 'electron-updater'

import { application } from '@application'
import { loggerService } from '@logger'
import { computeBackoff } from '@main/core/job/runtime/backoff'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { WindowType } from '@main/core/window/types'
import { applyForkUpdateFeed } from '@main/services/forkUpdateFeed'
import type { RetryPolicy } from '@shared/data/api/schemas/jobs'
import { hasMultiLanguageReleaseNotes, localizeReleaseNotes, type ReleaseNotesEntry } from '@shared/utils/releaseNotes'

const logger = loggerService.withContext('AppUpdaterService')

/**
 * A second updater on the same feed that only reads it (release notes, Doctor's update check),
 * leaving the app updater's download/install state alone. electron-updater is imported here, at
 * first use, rather than at boot.
 */
async function createReadOnlyUpdater(): Promise<AppUpdater> {
  const { AppUpdater } = await import('electron-updater')

  class ReleaseNotesUpdater extends AppUpdater {
    constructor() {
      super(undefined)
    }

    protected doDownloadUpdate(): Promise<string[]> {
      return Promise.reject(new Error('Release-notes updater cannot download updates'))
    }

    quitAndInstall(): never {
      throw new Error('Release-notes updater cannot install updates')
    }
  }

  const updater = new ReleaseNotesUpdater()
  updater.logger = logger as Logger
  updater.forceDevUpdateConfig = !app.isPackaged
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  applyForkUpdateFeed(updater)
  return updater
}

// Auto update-check scheduling. The cadence lives in the main process (this
// service), not the renderer, so it survives window close and runs exactly
// once regardless of how many windows are open.
const AUTO_UPDATE_SCHEDULE_ID = 'app-updater:auto-check'
// Base interval between automatic checks.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
// ± ratio of random jitter applied per cycle, so clients that launched around
// the same time don't all hit the update server on the same beat.
const CHECK_JITTER_RATIO = 0.15
// Short delay before the first check after startup, letting boot I/O settle.
const INITIAL_CHECK_DELAY_MS = 5_000
// Backoff for consecutive check failures: 5/10/20/40min, capped at 60min — always
// shorter than the normal cadence so a transient failure recovers sooner. Note
// `computeBackoff` ignores `maxAttempts`; auto-check never gives up, so it is a
// placeholder only to satisfy RetryPolicy's strictObject shape.
const CHECK_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoff: 'exponential',
  baseDelayMs: 5 * 60 * 1000,
  maxDelayMs: 60 * 60 * 1000
}

@Injectable('AppUpdaterService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'SchedulerService'])
export class AppUpdaterService extends BaseService {
  // electron-updater's `autoUpdater`, loaded and configured by the first update check.
  private autoUpdater: AppUpdater | null = null
  private autoUpdaterLoading: Promise<AppUpdater> | null = null
  // Consecutive scheduled-check failures, drives backoff; reset on success.
  private updateCheckFailures = 0

  protected async onInit(): Promise<void> {
    // Stop the scheduled check when this service stops (it depends on
    // SchedulerService, so SchedulerService is still alive at this point).
    this.registerDisposable(() => application.get('SchedulerService').unregister(AUTO_UPDATE_SCHEDULE_ID))
  }

  protected async onAllReady(): Promise<void> {
    application.get('PowerService').registerShutdownHandler(() => {
      if (this.autoUpdater) this.autoUpdater.autoDownload = false
    })

    // The automatic check is armed only while auto update is on, so a disabled
    // updater keeps no timer and never loads electron-updater.
    const preferences = application.get('PreferenceService')
    this.registerDisposable(
      preferences.subscribeChange('app.dist.auto_update.enabled', (enabled) => this.applyAutoUpdate(enabled))
    )
    this.applyAutoUpdate(preferences.get('app.dist.auto_update.enabled'))
  }

  private applyAutoUpdate(enabled: boolean): void {
    if (this.autoUpdater) this.autoUpdater.autoDownload = enabled

    // Development builds skip automatic checks but still support manual checks.
    // Portable builds do not perform update checks.
    if (!app.isPackaged || this.isPortable()) {
      return
    }
    if (enabled) {
      this.updateCheckFailures = 0
      this.scheduleNextUpdateCheck(INITIAL_CHECK_DELAY_MS)
    } else {
      application.get('SchedulerService').unregister(AUTO_UPDATE_SCHEDULE_ID)
    }
  }

  private getAutoUpdater(): Promise<AppUpdater> {
    this.autoUpdaterLoading ??= this.loadAutoUpdater().catch((error: unknown) => {
      this.autoUpdaterLoading = null
      throw error
    })
    return this.autoUpdaterLoading
  }

  private async loadAutoUpdater(): Promise<AppUpdater> {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.logger = logger as Logger
    // Packaged builds use app-update.yml generated from electron-builder.yml;
    // development uses the repository's dev-app-update.yml.
    autoUpdater.forceDevUpdateConfig = !app.isPackaged
    autoUpdater.autoDownload = application.get('PreferenceService').get('app.dist.auto_update.enabled')
    // Never auto-install on quit - user must explicitly click "Install Now"
    // Auto-install on quit can cause issues: unexpected updates on restart,
    // corruption if system shuts down during install, or app uninstall on force shutdown
    autoUpdater.autoInstallOnAppQuit = false
    applyForkUpdateFeed(autoUpdater)

    this.registerAutoUpdaterListeners(autoUpdater)

    if (isWin) {
      ;(autoUpdater as NsisUpdater).installDirectory = application.getPath('app.install')
    }

    this.autoUpdater = autoUpdater
    // The listeners above are disposed on stop; a restarted service configures afresh.
    this.registerDisposable(() => {
      this.autoUpdater = null
      this.autoUpdaterLoading = null
    })
    return autoUpdater
  }

  private registerAutoUpdaterListeners(autoUpdater: AppUpdater): void {
    const onError = (error: Error) => {
      logger.error('update error', error)
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.error', error)
    }
    autoUpdater.on('error', onError)
    this.registerDisposable(() => autoUpdater.removeListener('error', onError))

    const onUpdateAvailable = (releaseInfo: UpdateInfo) => {
      logger.info('update available', releaseInfo)
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.available', processedReleaseInfo)
    }
    autoUpdater.on('update-available', onUpdateAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-available', onUpdateAvailable))

    const onUpdateNotAvailable = () => {
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.not_available', undefined)
    }
    autoUpdater.on('update-not-available', onUpdateNotAvailable)
    this.registerDisposable(() => autoUpdater.removeListener('update-not-available', onUpdateNotAvailable))

    const onDownloadProgress = (progress: ProgressInfo) => {
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.download_progress', progress)
    }
    autoUpdater.on('download-progress', onDownloadProgress)
    this.registerDisposable(() => autoUpdater.removeListener('download-progress', onDownloadProgress))

    const onUpdateDownloaded = (releaseInfo: UpdateInfo) => {
      const processedReleaseInfo = this.processReleaseInfo(releaseInfo)
      application.get('IpcApiService').broadcastToType(WindowType.Main, 'app.updater.downloaded', processedReleaseInfo)
      logger.info('update downloaded', processedReleaseInfo)
    }
    autoUpdater.on('update-downloaded', onUpdateDownloaded)
    this.registerDisposable(() => autoUpdater.removeListener('update-downloaded', onUpdateDownloaded))
  }

  public async queryUpdateAvailability(): Promise<
    | { status: 'unsupported' }
    | { status: 'current'; currentVersion: string }
    | { status: 'available'; currentVersion: string; version: string }
  > {
    if (this.isPortable()) return { status: 'unsupported' }
    const currentVersion = app.getVersion()
    const updater = await createReadOnlyUpdater()
    const result = await updater.checkForUpdates()
    if (!result) throw new Error('Update query did not produce a result')
    return result.isUpdateAvailable
      ? { status: 'available', currentVersion, version: result.updateInfo.version }
      : { status: 'current', currentVersion }
  }

  public async getLatestReleaseNotes(): Promise<ReleaseNotesEntry | null> {
    try {
      const updater = await createReadOnlyUpdater()
      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable) {
        return null
      }

      const releaseNotes = result.updateInfo.releaseNotes
      if (typeof releaseNotes !== 'string' || !releaseNotes.trim()) {
        return null
      }

      return { releaseNotes, version: result.updateInfo.version }
    } catch (error) {
      logger.warn('Failed to fetch latest release notes', error as Error)
      return null
    }
  }

  /**
   * Releases newer than the bundled release history. The fork publishes no
   * release-history feed, so this is at most the update the feed offers.
   */
  public async getReleaseHistory(): Promise<ReleaseNotesEntry[] | null> {
    const latestRelease = await this.getLatestReleaseNotes()
    return latestRelease ? [latestRelease] : null
  }

  private isPortable(): boolean {
    return isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env
  }

  /**
   * Throwing core of the update check: updater setup → check → (manual) download
   * trigger. A check/network failure REJECTS so callers that need a failure
   * signal — the scheduler's backoff — can observe it. The public IPC entry
   * `checkForUpdates()` wraps this and swallows the error to preserve its
   * event-driven contract: errors reach the renderer via the `UpdateError`
   * broadcast (see `registerAutoUpdaterListeners`), not the return value.
   */
  private async performUpdateCheck() {
    void application.get('AnalyticsService').trackAppUpdate()

    if (this.isPortable()) {
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }

    const autoUpdater = await this.getAutoUpdater()

    const updateCheckResult = await autoUpdater.checkForUpdates()
    logger.info(
      `update check result: ${updateCheckResult?.isUpdateAvailable}, currentVersion: ${autoUpdater.currentVersion}`
    )

    if (updateCheckResult?.isUpdateAvailable && !autoUpdater.autoDownload) {
      // 如果 autoDownload 为 false，则需要再调用下面的函数触发下
      // do not use await, because it will block the return of this function
      logger.info('downloadUpdate manual by check for updates')
      void autoUpdater.downloadUpdate()
    }

    return {
      currentVersion: autoUpdater.currentVersion,
      updateInfo: updateCheckResult?.isUpdateAvailable ? updateCheckResult.updateInfo : null
    }
  }

  public async checkForUpdates() {
    try {
      return await this.performUpdateCheck()
    } catch (error) {
      logger.error('Failed to check for update:', error as Error)
      return {
        currentVersion: app.getVersion(),
        updateInfo: null
      }
    }
  }

  /**
   * Arm the next automatic check on SchedulerService as a one-shot `delayMs`
   * from now. Re-registering the same id replaces the prior timer, so the
   * callback re-arming itself with a freshly computed delay (jitter on success,
   * backoff on failure) forms the recurring loop. The returned Disposable is
   * discarded; cleanup is the single `unregister` registered in `onInit`.
   * Nothing is armed while auto update is off — including a re-arm after a
   * check that was in flight when the user switched it off.
   */
  private scheduleNextUpdateCheck(delayMs: number): void {
    if (!application.get('PreferenceService').get('app.dist.auto_update.enabled')) return
    application
      .get('SchedulerService')
      .registerSchedule(AUTO_UPDATE_SCHEDULE_ID, { kind: 'once', at: Date.now() + delayMs }, () =>
        this.runScheduledUpdateCheck()
      )
  }

  private async runScheduledUpdateCheck(): Promise<void> {
    try {
      // Only the detection failure of `performUpdateCheck` drives backoff — the
      // manual download trigger is fire-and-forget and surfaces its own errors
      // via the `UpdateError` event.
      await this.performUpdateCheck()
      this.updateCheckFailures = 0
      this.scheduleNextUpdateCheck(this.nextUpdateCheckDelayMs())
    } catch {
      this.updateCheckFailures++
      const backoffMs = computeBackoff(CHECK_RETRY_POLICY, this.updateCheckFailures)
      logger.warn(`scheduled update check failed, backing off for ${backoffMs}ms`)
      this.scheduleNextUpdateCheck(backoffMs)
    }
  }

  private nextUpdateCheckDelayMs(): number {
    return Math.round(CHECK_INTERVAL_MS * (1 + (Math.random() * 2 - 1) * CHECK_JITTER_RATIO))
  }

  public quitAndInstall() {
    // Only reachable after an update was downloaded, i.e. after the updater loaded.
    const autoUpdater = this.autoUpdater
    if (!autoUpdater) {
      logger.warn('quitAndInstall requested before any update check')
      return
    }
    application.markQuitting()
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }

  /**
   * Process release info to handle multi-language release notes
   * @param releaseInfo - Original release info from updater
   * @returns Processed release info with localized release notes
   */
  private processReleaseInfo(releaseInfo: UpdateInfo): UpdateInfo {
    const processedInfo = { ...releaseInfo }

    // Handle multi-language release notes in string format
    if (releaseInfo.releaseNotes && typeof releaseInfo.releaseNotes === 'string') {
      if (hasMultiLanguageReleaseNotes(releaseInfo.releaseNotes)) {
        try {
          const language = application.get('PreferenceService').get('app.language')
          processedInfo.releaseNotes = localizeReleaseNotes(releaseInfo.releaseNotes, language)
        } catch (error) {
          logger.error('Failed to localize release notes', error as Error)
        }
      }
    }

    return processedInfo
  }
}
