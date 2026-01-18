import { loggerService } from '@logger'
import db from '@renderer/databases'
import { upgradeToV7, upgradeToV8 } from '@renderer/databases/upgrades'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { setLocalBackupSyncState, setS3SyncState, setWebDAVSyncState } from '@renderer/store/backup'
import type { S3Config, WebDavConfig } from '@renderer/types'
import { uuid } from '@renderer/utils'
import dayjs from 'dayjs'

import { NotificationService } from './NotificationService'

const logger = loggerService.withContext('BackupService')

type BackupMode = 'full' | 'incremental'

type BackupManifest = {
  schemaVersion: 1
  backupType: BackupMode
  baseTime: number
  generatedAt: number
  conversationScope: 'topics'
}

const BACKUP_LAST_AT_KEY = 'cherry-studio.backup.lastBackupAt'

const toTimestampMs = (value: string | number | undefined): number => {
  if (typeof value === 'number') {
    return value > 1e12 ? value : value * 1000
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

const getMessageTimestamp = (message: { updatedAt?: string; createdAt?: string }) =>
  toTimestampMs(message.updatedAt) || toTimestampMs(message.createdAt)

const getMessageCreatedTimestamp = (message: { updatedAt?: string; createdAt?: string }) =>
  toTimestampMs(message.createdAt) || toTimestampMs(message.updatedAt)

const getTopicTimestamp = (topic: { updatedAt?: string; createdAt?: string }) =>
  toTimestampMs(topic.updatedAt) || toTimestampMs(topic.createdAt)

const getLastBackupAt = () => {
  const rawValue = localStorage.getItem(BACKUP_LAST_AT_KEY)
  const parsed = rawValue ? Number(rawValue) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

const setLastBackupAt = (value: number) => {
  localStorage.setItem(BACKUP_LAST_AT_KEY, String(value))
}

const buildBackupManifest = (backupType: BackupMode, baseTime: number): BackupManifest => ({
  schemaVersion: 1,
  backupType,
  baseTime,
  generatedAt: Date.now(),
  conversationScope: 'topics'
})

export const resolveBackupPayload = async () => {
  const lastBackupAt = getLastBackupAt()
  const backupType: BackupMode = lastBackupAt > 0 ? 'incremental' : 'full'
  const baseTime = backupType === 'incremental' ? lastBackupAt : 0
  const data = await getBackupData({ backupType, baseTime })
  const manifest = buildBackupManifest(backupType, baseTime)
  return { data, manifest }
}

export const recordBackupSuccess = (manifest: BackupManifest) => {
  setLastBackupAt(manifest.generatedAt)
}

export const mergeMessagesByUpdatedAt = <T extends { id: string; createdAt?: string; updatedAt?: string }>(
  currentMessages: T[],
  incomingMessages: T[]
): T[] => {
  if (!incomingMessages.length) {
    return currentMessages
  }

  const merged = [...currentMessages]
  const indexById = new Map(currentMessages.map((message, index) => [message.id, index]))

  for (const incoming of incomingMessages) {
    const existingIndex = indexById.get(incoming.id)
    if (existingIndex === undefined) {
      merged.push(incoming)
      continue
    }

    const existing = merged[existingIndex]
    if (getMessageTimestamp(incoming) >= getMessageTimestamp(existing)) {
      merged[existingIndex] = incoming
    }
  }

  return merged.sort((a, b) => getMessageCreatedTimestamp(a) - getMessageCreatedTimestamp(b))
}

// 重试删除S3文件的辅助函数
async function deleteS3FileWithRetry(fileName: string, s3Config: S3Config, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteS3File(fileName, s3Config)
      logger.verbose(`Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      logger.warn(`Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

// 重试删除WebDAV文件的辅助函数
async function deleteWebdavFileWithRetry(fileName: string, webdavConfig: WebDavConfig, maxRetries = 3) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await window.api.backup.deleteWebdavFile(fileName, webdavConfig)
      logger.verbose(`Successfully deleted old backup file: ${fileName} (attempt ${attempt})`)
      return true
    } catch (error: any) {
      lastError = error
      logger.warn(`Delete attempt ${attempt}/${maxRetries} failed for ${fileName}:`, error.message)

      // 如果不是最后一次尝试，等待一段时间再重试
      if (attempt < maxRetries) {
        const delay = attempt * 1000 + Math.random() * 1000 // 1-2秒的随机延迟
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  logger.error(`Failed to delete old backup file after ${maxRetries} attempts: ${fileName}`, lastError)
  return false
}

export async function backup(skipBackupFile: boolean) {
  const filename = `cherry-studio.${dayjs().format('YYYYMMDDHHmm')}.zip`
  const { data: fileContnet, manifest } = await resolveBackupPayload()
  const selectFolder = await window.api.file.selectFolder()
  if (selectFolder) {
    await window.api.backup.backup(filename, fileContnet, selectFolder, skipBackupFile, JSON.stringify(manifest))
    recordBackupSuccess(manifest)
    window.toast.success(i18n.t('message.backup.success'))
  }
}

export async function restore() {
  const notificationService = NotificationService.getInstance()
  const file = await window.api.file.open({ filters: [{ name: '备份文件', extensions: ['bak', 'zip'] }] })

  if (file) {
    try {
      let data: Record<string, any> = {}

      // zip backup file
      if (file?.fileName.endsWith('.zip')) {
        const restoreData = await window.api.backup.restore(file.filePath)
        data = JSON.parse(restoreData)
      } else {
        data = JSON.parse(await window.api.zip.decompress(file.content))
      }

      await handleData(data)

      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.restore.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
    } catch (error) {
      logger.error('restore: Error restoring backup file:', error as Error)
      window.toast.error(i18n.t('error.backup.file_format'))
    }
  }
}

export async function reset() {
  window.modal.confirm({
    title: i18n.t('common.warning'),
    content: i18n.t('message.reset.confirm.content'),
    centered: true,
    okButtonProps: {
      danger: true
    },
    onOk: async () => {
      window.modal.confirm({
        title: i18n.t('message.reset.double.confirm.title'),
        content: i18n.t('message.reset.double.confirm.content'),
        centered: true,
        onOk: async () => {
          await localStorage.clear()
          await clearDatabase()
          await window.api.file.clear()
          window.api.reload()
        }
      })
    }
  })
}

// 备份到 webdav
/**
 * @param showMessage
 * @param customFileName
 * @param autoBackupProcess
 * if call in auto backup process, not show any message, any error will be thrown
 */
export async function backupToWebdav({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setWebDAVSyncState({ syncing: true, lastSyncError: null }))

  const {
    webdavHost,
    webdavUser,
    webdavPass,
    webdavPath,
    webdavMaxBackups,
    webdavSkipBackupFile,
    webdavDisableStream
  } = store.getState().settings
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const { data: backupData, manifest } = await resolveBackupPayload()

  // 上传文件
  try {
    const success = await window.api.backup.backupToWebdav(
      backupData,
      {
        webdavHost,
        webdavUser,
        webdavPass,
        webdavPath,
        fileName: finalFileName,
        skipBackupFile: webdavSkipBackupFile,
        disableStream: webdavDisableStream
      },
      JSON.stringify(manifest)
    )
    if (success) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncError: null
        })
      )
      recordBackupSuccess(manifest)
      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
      showMessage && window.toast.success(i18n.t('message.backup.success'))

      // 清理旧备份文件
      if (webdavMaxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listWebdavFiles({
            webdavHost,
            webdavUser,
            webdavPass,
            webdavPath
          })

          // 筛选当前设备的备份文件
          const currentDeviceFiles = files.filter((file) => {
            // 检查文件名是否包含当前设备的标识信息
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > webdavMaxBackups) {
            // 文件已按修改时间降序排序，所以最旧的文件在末尾
            const filesToDelete = currentDeviceFiles.slice(webdavMaxBackups)

            logger.verbose(`Cleaning up ${filesToDelete.length} old backup files`)

            // 串行删除文件，避免并发请求导致的问题
            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteWebdavFileWithRetry(file.fileName, {
                webdavHost,
                webdavUser,
                webdavPass,
                webdavPath
              })

              // 在删除操作之间添加短暂延迟，避免请求过于频繁
              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          logger.error('Failed to clean up old backup files:', error as Error)
        }
      }
    } else {
      // if auto backup process, throw error
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setWebDAVSyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.toast.error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    // if auto backup process, throw error
    if (autoBackupProcess) {
      throw error
    }
    notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
    store.dispatch(setWebDAVSyncState({ lastSyncError: error.message }))
    showMessage && window.toast.error(i18n.t('message.backup.failed'))
    logger.error('[Backup] backupToWebdav: Error uploading file to WebDAV:', error)
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setWebDAVSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 webdav 恢复
export async function restoreFromWebdav(fileName?: string) {
  const { webdavHost, webdavUser, webdavPass, webdavPath } = store.getState().settings
  let data = ''

  try {
    data = await window.api.backup.restoreFromWebdav({ webdavHost, webdavUser, webdavPass, webdavPath, fileName })
  } catch (error: any) {
    logger.error('[Backup] restoreFromWebdav: Error downloading file from WebDAV:', error)
    window.modal.error({
      title: i18n.t('message.restore.failed'),
      content: error.message
    })
  }

  try {
    await handleData(JSON.parse(data))
  } catch (error) {
    logger.error('[Backup] Error downloading file from WebDAV:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
  }
}

export async function backupToS3({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }

  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setS3SyncState({ syncing: true, lastSyncError: null }))

  const s3Config = store.getState().settings.s3
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const { data: backupData, manifest } = await resolveBackupPayload()

  try {
    const success = await window.api.backup.backupToS3(
      backupData,
      {
        ...s3Config,
        fileName: finalFileName
      },
      JSON.stringify(manifest)
    )

    if (success) {
      recordBackupSuccess(manifest)
      store.dispatch(
        setS3SyncState({
          lastSyncError: null,
          syncing: false,
          lastSyncTime: Date.now()
        })
      )
      notificationService.send({
        id: uuid(),
        type: 'success',
        title: i18n.t('common.success'),
        message: i18n.t('message.backup.success'),
        silent: false,
        timestamp: Date.now(),
        source: 'backup',
        channel: 'system'
      })
      showMessage && window.toast.success(i18n.t('message.backup.success'))

      // 清理旧备份文件
      if (s3Config.maxBackups > 0) {
        try {
          // 获取所有备份文件
          const files = await window.api.backup.listS3Files(s3Config)

          // 筛选当前设备的备份文件
          const currentDeviceFiles = files.filter((file) => {
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          // 如果当前设备的备份文件数量超过最大保留数量，删除最旧的文件
          if (currentDeviceFiles.length > s3Config.maxBackups) {
            const filesToDelete = currentDeviceFiles.slice(s3Config.maxBackups)

            logger.verbose(`Cleaning up ${filesToDelete.length} old backup files`)

            for (let i = 0; i < filesToDelete.length; i++) {
              const file = filesToDelete[i]
              await deleteS3FileWithRetry(file.fileName, s3Config)

              if (i < filesToDelete.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
          }
        } catch (error) {
          logger.error('Failed to clean up old backup files:', error as Error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(setS3SyncState({ lastSyncError: 'Backup failed' }))
      showMessage && window.toast.error(i18n.t('message.backup.failed'))
    }
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }
    notificationService.send({
      id: uuid(),
      type: 'error',
      title: i18n.t('message.backup.failed'),
      message: error.message,
      silent: false,
      timestamp: Date.now(),
      source: 'backup',
      channel: 'system'
    })
    store.dispatch(setS3SyncState({ lastSyncError: error.message }))
    logger.error('backupToS3: Error uploading file to S3:', error)
    showMessage && window.toast.error(i18n.t('message.backup.failed'))
    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setS3SyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

// 从 S3 恢复
export async function restoreFromS3(fileName?: string) {
  const s3Config = store.getState().settings.s3

  if (!fileName) {
    const files = await window.api.backup.listS3Files(s3Config)
    if (files.length > 0) {
      fileName = files[0].fileName
    }
  }

  if (fileName) {
    const restoreData = await window.api.backup.restoreFromS3({
      ...s3Config,
      fileName
    })
    const data = JSON.parse(restoreData)
    await handleData(data)
  }
}

let isManualBackupRunning = false

// 为每种备份类型维护独立的状态
let webdavAutoSyncStarted = false
let webdavSyncTimeout: NodeJS.Timeout | null = null
let isWebdavAutoBackupRunning = false

let s3AutoSyncStarted = false
let s3SyncTimeout: NodeJS.Timeout | null = null
let isS3AutoBackupRunning = false

let localAutoSyncStarted = false
let localSyncTimeout: NodeJS.Timeout | null = null
let isLocalAutoBackupRunning = false

type BackupType = 'webdav' | 's3' | 'local'

export function startAutoSync(immediate = false, type?: BackupType) {
  // 如果没有指定类型，启动所有配置的自动同步
  if (!type) {
    const settings = store.getState().settings
    const { webdavAutoSync, webdavHost, localBackupAutoSync, localBackupDir } = settings
    const s3Settings = settings.s3

    if (webdavAutoSync && webdavHost) {
      startAutoSync(immediate, 'webdav')
    }
    if (s3Settings?.autoSync && s3Settings?.endpoint) {
      startAutoSync(immediate, 's3')
    }
    if (localBackupAutoSync && localBackupDir) {
      startAutoSync(immediate, 'local')
    }
    return
  }

  // 根据类型启动特定的自动同步
  if (type === 'webdav') {
    if (webdavAutoSyncStarted) {
      return
    }

    const settings = store.getState().settings
    const { webdavAutoSync, webdavHost } = settings

    if (!webdavAutoSync || !webdavHost) {
      logger.info('[WebdavAutoSync] Invalid sync settings, auto sync disabled')
      return
    }

    webdavAutoSyncStarted = true
    stopAutoSync('webdav')
    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'webdav')
  } else if (type === 's3') {
    if (s3AutoSyncStarted) {
      return
    }

    const settings = store.getState().settings
    const s3Settings = settings.s3

    if (!s3Settings?.autoSync || !s3Settings?.endpoint) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      return
    }

    s3AutoSyncStarted = true
    stopAutoSync('s3')
    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 's3')
  } else if (type === 'local') {
    if (localAutoSyncStarted) {
      return
    }

    const settings = store.getState().settings
    const { localBackupAutoSync, localBackupDir } = settings

    if (!localBackupAutoSync || !localBackupDir) {
      logger.verbose('Invalid sync settings, auto sync disabled')
      return
    }

    localAutoSyncStarted = true
    stopAutoSync('local')
    scheduleNextBackup(immediate ? 'immediate' : 'fromLastSyncTime', 'local')
  }

  function scheduleNextBackup(scheduleType: 'immediate' | 'fromLastSyncTime' | 'fromNow', backupType: BackupType) {
    let syncInterval: number
    let lastSyncTime: number | undefined
    let logPrefix: string

    // 根据备份类型获取相应的配置和状态
    const settings = store.getState().settings
    const backup = store.getState().backup

    if (backupType === 'webdav') {
      if (webdavSyncTimeout) {
        clearTimeout(webdavSyncTimeout)
        webdavSyncTimeout = null
      }
      syncInterval = settings.webdavSyncInterval
      lastSyncTime = backup.webdavSync?.lastSyncTime || undefined
      logPrefix = '[WebdavAutoSync]'
    } else if (backupType === 's3') {
      if (s3SyncTimeout) {
        clearTimeout(s3SyncTimeout)
        s3SyncTimeout = null
      }
      syncInterval = settings.s3?.syncInterval || 0
      lastSyncTime = backup.s3Sync?.lastSyncTime || undefined
      logPrefix = '[S3AutoSync]'
    } else if (backupType === 'local') {
      if (localSyncTimeout) {
        clearTimeout(localSyncTimeout)
        localSyncTimeout = null
      }
      syncInterval = settings.localBackupSyncInterval
      lastSyncTime = backup.localBackupSync?.lastSyncTime || undefined
      logPrefix = '[LocalAutoSync]'
    } else {
      return
    }

    if (!syncInterval || syncInterval <= 0) {
      logger.verbose(`${logPrefix} Invalid sync interval, auto sync disabled`)
      stopAutoSync(backupType)
      return
    }

    const requiredInterval = syncInterval * 60 * 1000
    let timeUntilNextSync = 1000

    switch (scheduleType) {
      case 'fromLastSyncTime':
        timeUntilNextSync = Math.max(1000, (lastSyncTime || 0) + requiredInterval - Date.now())
        break
      case 'fromNow':
        timeUntilNextSync = requiredInterval
        break
    }

    const timeout = setTimeout(() => performAutoBackup(backupType), timeUntilNextSync)

    // 保存对应类型的 timeout
    if (backupType === 'webdav') {
      webdavSyncTimeout = timeout
    } else if (backupType === 's3') {
      s3SyncTimeout = timeout
    } else if (backupType === 'local') {
      localSyncTimeout = timeout
    }

    logger.verbose(
      `${logPrefix} Next sync scheduled in ${Math.floor(timeUntilNextSync / 1000 / 60)} minutes ${Math.floor(
        (timeUntilNextSync / 1000) % 60
      )} seconds`
    )
  }

  async function performAutoBackup(backupType: BackupType) {
    let isRunning: boolean
    let logPrefix: string

    if (backupType === 'webdav') {
      isRunning = isWebdavAutoBackupRunning
      logPrefix = '[WebdavAutoSync]'
    } else if (backupType === 's3') {
      isRunning = isS3AutoBackupRunning
      logPrefix = '[S3AutoSync]'
    } else if (backupType === 'local') {
      isRunning = isLocalAutoBackupRunning
      logPrefix = '[LocalAutoSync]'
    } else {
      return
    }

    if (isRunning || isManualBackupRunning) {
      logger.verbose(`${logPrefix} Backup already in progress, rescheduling`)
      scheduleNextBackup('fromNow', backupType)
      return
    }

    // 设置运行状态
    if (backupType === 'webdav') {
      isWebdavAutoBackupRunning = true
    } else if (backupType === 's3') {
      isS3AutoBackupRunning = true
    } else if (backupType === 'local') {
      isLocalAutoBackupRunning = true
    }

    const maxRetries = 4
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        logger.verbose(`${logPrefix} Starting auto backup... (attempt ${retryCount + 1}/${maxRetries})`)

        if (backupType === 'webdav') {
          await backupToWebdav({ autoBackupProcess: true })
          store.dispatch(
            setWebDAVSyncState({
              lastSyncError: null,
              lastSyncTime: Date.now(),
              syncing: false
            })
          )
        } else if (backupType === 's3') {
          await backupToS3({ autoBackupProcess: true })
          store.dispatch(
            setS3SyncState({
              lastSyncError: null,
              lastSyncTime: Date.now(),
              syncing: false
            })
          )
        } else if (backupType === 'local') {
          await backupToLocal({ autoBackupProcess: true })
          store.dispatch(
            setLocalBackupSyncState({
              lastSyncError: null,
              lastSyncTime: Date.now(),
              syncing: false
            })
          )
        }

        // 重置运行状态
        if (backupType === 'webdav') {
          isWebdavAutoBackupRunning = false
        } else if (backupType === 's3') {
          isS3AutoBackupRunning = false
        } else if (backupType === 'local') {
          isLocalAutoBackupRunning = false
        }

        scheduleNextBackup('fromNow', backupType)
        break
      } catch (error: any) {
        retryCount++
        if (retryCount === maxRetries) {
          logger.error(`${logPrefix} Auto backup failed after all retries:`, error)

          if (backupType === 'webdav') {
            store.dispatch(
              setWebDAVSyncState({
                lastSyncError: 'Auto backup failed',
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          } else if (backupType === 's3') {
            store.dispatch(
              setS3SyncState({
                lastSyncError: 'Auto backup failed',
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          } else if (backupType === 'local') {
            store.dispatch(
              setLocalBackupSyncState({
                lastSyncError: 'Auto backup failed',
                lastSyncTime: Date.now(),
                syncing: false
              })
            )
          }

          await window.modal.error({
            title: i18n.t('message.backup.failed'),
            content: `${logPrefix} ${new Date().toLocaleString()} ` + error.message
          })

          scheduleNextBackup('fromNow', backupType)

          // 重置运行状态
          if (backupType === 'webdav') {
            isWebdavAutoBackupRunning = false
          } else if (backupType === 's3') {
            isS3AutoBackupRunning = false
          } else if (backupType === 'local') {
            isLocalAutoBackupRunning = false
          }
        } else {
          const backoffDelay = Math.pow(2, retryCount - 1) * 10000 - 3000
          logger.warn(`${logPrefix} Failed, retry ${retryCount}/${maxRetries} after ${backoffDelay / 1000}s`)

          await new Promise((resolve) => setTimeout(resolve, backoffDelay))

          // 检查是否被用户停止
          let currentRunning: boolean
          if (backupType === 'webdav') {
            currentRunning = isWebdavAutoBackupRunning
          } else if (backupType === 's3') {
            currentRunning = isS3AutoBackupRunning
          } else {
            currentRunning = isLocalAutoBackupRunning
          }

          if (!currentRunning) {
            logger.info(`${logPrefix} retry cancelled by user, exit`)
            break
          }
        }
      }
    }
  }
}

export function stopAutoSync(type?: BackupType) {
  // 如果没有指定类型，停止所有自动同步
  if (!type) {
    stopAutoSync('webdav')
    stopAutoSync('s3')
    stopAutoSync('local')
    return
  }

  if (type === 'webdav') {
    if (webdavSyncTimeout) {
      logger.info('[WebdavAutoSync] Stopping auto sync')
      clearTimeout(webdavSyncTimeout)
      webdavSyncTimeout = null
    }
    isWebdavAutoBackupRunning = false
    webdavAutoSyncStarted = false
  } else if (type === 's3') {
    if (s3SyncTimeout) {
      logger.info('[S3AutoSync] Stopping auto sync')
      clearTimeout(s3SyncTimeout)
      s3SyncTimeout = null
    }
    isS3AutoBackupRunning = false
    s3AutoSyncStarted = false
  } else if (type === 'local') {
    if (localSyncTimeout) {
      logger.info('[LocalAutoSync] Stopping auto sync')
      clearTimeout(localSyncTimeout)
      localSyncTimeout = null
    }
    isLocalAutoBackupRunning = false
    localAutoSyncStarted = false
  }
}

export async function getBackupData(options?: { backupType?: BackupMode; baseTime?: number }) {
  const backupType = options?.backupType ?? 'full'
  const baseTime = options?.baseTime ?? 0
  const indexedDB =
    backupType === 'incremental' && baseTime > 0 ? await backupIncrementalDatabase(baseTime) : await backupDatabase()

  return JSON.stringify({
    time: new Date().getTime(),
    version: 5,
    backupType,
    baseTime,
    localStorage: {
      'persist:cherry-studio': localStorage.getItem('persist:cherry-studio') || '{}'
    },
    indexedDB
  })
}

/************************************* Backup Utils ************************************** */
export async function handleData(data: Record<string, any>) {
  const backupType = data?.manifest?.backupType ?? data?.backupType

  if (backupType === 'incremental') {
    await mergeIncrementalPersistState(data?.localStorage?.['persist:cherry-studio'])
    await restoreIncrementalDatabase(data?.indexedDB || {})
    window.toast.success(i18n.t('message.restore.success'))
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  if (data.version === 1) {
    await clearDatabase()

    for (const { key, value } of data.indexedDB) {
      if (key.startsWith('topic:')) {
        await db.table('topics').add({ id: value.id, messages: value.messages })
      }
      if (key === 'image://avatar') {
        await db.table('settings').add({ id: key, value })
      }
    }

    await localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])
    window.toast.success(i18n.t('message.restore.success'))
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  if (data.version >= 2) {
    localStorage.setItem('persist:cherry-studio', data.localStorage['persist:cherry-studio'])

    // remove notes_tree from indexedDB
    if (data.indexedDB['notes_tree']) {
      delete data.indexedDB['notes_tree']
    }

    await restoreDatabase(data.indexedDB)

    if (data.version === 3) {
      await db.transaction('rw', db.tables, async (tx) => {
        await db.table('message_blocks').clear()
        await upgradeToV7(tx)
      })
    }

    if (data.version === 4) {
      await db.transaction('rw', db.tables, async (tx) => {
        await upgradeToV8(tx)
      })
    }

    window.toast.success(i18n.t('message.restore.success'))
    setTimeout(() => window.api.reload(), 1000)
    return
  }

  window.toast.error(i18n.t('error.backup.file_format'))
}

async function backupDatabase() {
  const tables = db.tables
  const backup = {}

  for (const table of tables) {
    backup[table.name] = await table.toArray()
  }

  return backup
}

async function backupIncrementalDatabase(baseTime: number) {
  const topics = await db.topics.toArray()
  const incrementalTopics: Array<{ id: string; messages: any[] }> = []
  const blockIds = new Set<string>()

  for (const topic of topics) {
    const messages = Array.isArray(topic.messages)
      ? topic.messages.filter((message) => getMessageTimestamp(message) > baseTime)
      : []
    if (messages.length > 0) {
      incrementalTopics.push({ id: topic.id, messages })
      messages.forEach((message) => {
        if (Array.isArray(message.blocks)) {
          message.blocks.forEach((blockId: string) => blockIds.add(blockId))
        }
      })
    }
  }

  const messageBlocks = blockIds.size > 0 ? await db.message_blocks.bulkGet([...blockIds]) : []

  return {
    topics: incrementalTopics,
    message_blocks: messageBlocks.filter(Boolean)
  }
}

async function restoreDatabase(backup: Record<string, any>) {
  await db.transaction('rw', db.tables, async () => {
    for (const tableName in backup) {
      await db.table(tableName).clear()
      await db.table(tableName).bulkAdd(backup[tableName])
    }
  })
}

async function restoreIncrementalDatabase(backup: Record<string, any>) {
  const incomingTopics = Array.isArray(backup.topics) ? backup.topics : []
  const incomingBlocks = Array.isArray(backup.message_blocks) ? backup.message_blocks : []

  await db.transaction('rw', db.topics, db.message_blocks, async () => {
    if (incomingBlocks.length > 0) {
      await db.message_blocks.bulkPut(incomingBlocks)
    }

    for (const incomingTopic of incomingTopics) {
      const existingTopic = await db.topics.get(incomingTopic.id)
      const mergedMessages = mergeMessagesByUpdatedAt(
        Array.isArray(existingTopic?.messages) ? existingTopic.messages : [],
        Array.isArray(incomingTopic.messages) ? incomingTopic.messages : []
      )
      await db.topics.put({ id: incomingTopic.id, messages: mergedMessages })
    }
  })
}

const parsePersistedState = (payload?: string) => {
  if (!payload) return null
  try {
    return JSON.parse(payload) as Record<string, string>
  } catch (error) {
    logger.error('[Backup] Failed to parse persisted state', error as Error)
    return null
  }
}

const mergeIncrementalPersistState = async (incomingPersist?: string) => {
  if (!incomingPersist) return

  const currentPersistRaw = localStorage.getItem('persist:cherry-studio') || '{}'
  const currentPersist = (parsePersistedState(currentPersistRaw) || {}) as Record<string, string>
  const incomingPersistState = parsePersistedState(incomingPersist) as Record<string, string> | null

  if (!incomingPersistState?.assistants) {
    return
  }

  const currentAssistantsState = parsePersistedState(currentPersist.assistants) || {}
  const incomingAssistantsState = parsePersistedState(incomingPersistState.assistants) || {}
  const mergedAssistantsState = mergeAssistantTopics(currentAssistantsState, incomingAssistantsState)

  currentPersist.assistants = JSON.stringify(mergedAssistantsState)
  localStorage.setItem('persist:cherry-studio', JSON.stringify(currentPersist))
}

const mergeAssistantTopics = (currentState: any, incomingState: any) => {
  const currentAssistants = Array.isArray(currentState?.assistants) ? currentState.assistants : []
  const incomingAssistants = Array.isArray(incomingState?.assistants) ? incomingState.assistants : []
  const mergedAssistants = [...currentAssistants]
  const indexById = new Map<string, number>()
  currentAssistants.forEach((assistant: any, index: number) => {
    if (assistant?.id) {
      indexById.set(String(assistant.id), index)
    }
  })
  const unifiedListOrder = Array.isArray(currentState?.unifiedListOrder) ? [...currentState.unifiedListOrder] : []
  const unifiedIds = new Set(unifiedListOrder.map((item: any) => item?.id))

  for (const incoming of incomingAssistants) {
    const existingIndex = indexById.get(String(incoming?.id ?? ''))
    if (existingIndex === undefined) {
      mergedAssistants.push({
        ...incoming,
        topics: Array.isArray(incoming.topics) ? incoming.topics.map((topic: any) => ({ ...topic, messages: [] })) : []
      })
      if (!unifiedIds.has(incoming.id)) {
        unifiedListOrder.push({ type: incoming.type || 'assistant', id: incoming.id })
        unifiedIds.add(incoming.id)
      }
      continue
    }

    const existing = mergedAssistants[existingIndex]
    const mergedTopics = mergeTopicsByUpdatedAt(existing?.topics, incoming?.topics)
    mergedAssistants[existingIndex] = {
      ...existing,
      topics: mergedTopics
    }
  }

  return {
    ...currentState,
    assistants: mergedAssistants,
    unifiedListOrder
  }
}

const mergeTopicsByUpdatedAt = (currentTopics: any, incomingTopics: any) => {
  const safeCurrentTopics = Array.isArray(currentTopics) ? currentTopics : []
  const safeIncomingTopics = Array.isArray(incomingTopics) ? incomingTopics : []

  const merged = [...safeCurrentTopics]
  const indexById = new Map(safeCurrentTopics.map((topic: any, index: number) => [topic.id, index]))

  for (const incoming of safeIncomingTopics) {
    const existingIndex = indexById.get(incoming.id)
    if (existingIndex === undefined) {
      merged.push({ ...incoming, messages: [] })
      continue
    }

    const existing = merged[existingIndex]
    if (getTopicTimestamp(incoming) >= getTopicTimestamp(existing)) {
      merged[existingIndex] = { ...existing, ...incoming, messages: [] }
    }
  }

  return merged
}

async function clearDatabase() {
  const storeNames = await db.tables.map((table) => table.name)

  await db.transaction('rw', db.tables, async () => {
    for (const storeName of storeNames) {
      await db[storeName].clear()
    }
  })
}

/**
 * Backup to local directory
 */
export async function backupToLocal({
  showMessage = false,
  customFileName = '',
  autoBackupProcess = false
}: {
  showMessage?: boolean
  customFileName?: string
  autoBackupProcess?: boolean
} = {}) {
  const notificationService = NotificationService.getInstance()
  if (isManualBackupRunning) {
    logger.verbose('Manual backup already in progress')
    return
  }
  // force set showMessage to false when auto backup process
  if (autoBackupProcess) {
    showMessage = false
  }

  isManualBackupRunning = true

  store.dispatch(setLocalBackupSyncState({ syncing: true, lastSyncError: null }))

  const {
    localBackupDir: localBackupDirSetting,
    localBackupMaxBackups,
    localBackupSkipBackupFile
  } = store.getState().settings
  const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
  let deviceType = 'unknown'
  let hostname = 'unknown'
  try {
    deviceType = (await window.api.system.getDeviceType()) || 'unknown'
    hostname = (await window.api.system.getHostname()) || 'unknown'
  } catch (error) {
    logger.error('Failed to get device type or hostname:', error as Error)
  }
  const timestamp = dayjs().format('YYYYMMDDHHmmss')
  const backupFileName = customFileName || `cherry-studio.${timestamp}.${hostname}.${deviceType}.zip`
  const finalFileName = backupFileName.endsWith('.zip') ? backupFileName : `${backupFileName}.zip`
  const { data: backupData, manifest } = await resolveBackupPayload()

  try {
    const result = await window.api.backup.backupToLocalDir(
      backupData,
      finalFileName,
      {
        localBackupDir,
        skipBackupFile: localBackupSkipBackupFile
      },
      JSON.stringify(manifest)
    )

    if (result) {
      recordBackupSuccess(manifest)
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: null
        })
      )

      if (showMessage) {
        notificationService.send({
          id: uuid(),
          type: 'success',
          title: i18n.t('common.success'),
          message: i18n.t('message.backup.success'),
          silent: false,
          timestamp: Date.now(),
          source: 'backup',
          channel: 'system'
        })
      }

      // Clean up old backups if maxBackups is set
      if (localBackupMaxBackups > 0) {
        try {
          // Get all backup files
          const files = await window.api.backup.listLocalBackupFiles(localBackupDir)

          // Filter backups for current device
          const currentDeviceFiles = files.filter((file) => {
            return file.fileName.includes(deviceType) && file.fileName.includes(hostname)
          })

          if (currentDeviceFiles.length > localBackupMaxBackups) {
            // Sort by modified time (oldest first)
            const filesToDelete = currentDeviceFiles
              .sort((a, b) => new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime())
              .slice(0, currentDeviceFiles.length - localBackupMaxBackups)

            // Delete older backups
            for (const file of filesToDelete) {
              logger.verbose(`[LocalBackup] Deleting old backup: ${file.fileName}`)
              await window.api.backup.deleteLocalBackupFile(file.fileName, localBackupDir)
            }
          }
        } catch (error) {
          logger.error('[LocalBackup] Failed to clean up old backups:', error as Error)
        }
      }
    } else {
      if (autoBackupProcess) {
        throw new Error(i18n.t('message.backup.failed'))
      }

      store.dispatch(
        setLocalBackupSyncState({
          lastSyncError: 'Backup failed'
        })
      )

      if (showMessage) {
        window.modal.error({
          title: i18n.t('message.backup.failed'),
          content: 'Backup failed'
        })
      }
    }

    return result
  } catch (error: any) {
    if (autoBackupProcess) {
      throw error
    }

    logger.error('[LocalBackup] Backup failed:', error)

    store.dispatch(
      setLocalBackupSyncState({
        lastSyncError: error.message || 'Unknown error'
      })
    )

    if (showMessage) {
      window.modal.error({
        title: i18n.t('message.backup.failed'),
        content: error.message || 'Unknown error'
      })
    }

    throw error
  } finally {
    if (!autoBackupProcess) {
      store.dispatch(
        setLocalBackupSyncState({
          lastSyncTime: Date.now(),
          syncing: false
        })
      )
    }
    isManualBackupRunning = false
  }
}

export async function restoreFromLocal(fileName: string) {
  try {
    const { localBackupDir: localBackupDirSetting } = store.getState().settings
    const localBackupDir = await window.api.resolvePath(localBackupDirSetting)
    const restoreData = await window.api.backup.restoreFromLocalBackup(fileName, localBackupDir)
    const data = JSON.parse(restoreData)
    await handleData(data)

    return true
  } catch (error) {
    logger.error('[LocalBackup] Restore failed:', error as Error)
    window.toast.error(i18n.t('error.backup.file_format'))
    throw error
  }
}
