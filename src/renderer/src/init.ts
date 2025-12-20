import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'
import { isWebRuntime } from '@renderer/utils/platform'

import { startAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import storeSyncService from './services/StoreSyncService'
import { initWebApiBridge } from './services/web/WebApiBridge'
import { webTraceService } from './services/WebTraceService'
import store from './store'

loggerService.initWindowSource('mainWindow')

if (isWebRuntime()) {
  initWebApiBridge()
}

function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

function initAutoSync() {
  if (isWebRuntime()) {
    return
  }
  setTimeout(() => {
    const { webdavAutoSync, localBackupAutoSync, s3 } = store.getState().settings
    const { nutstoreAutoSync } = store.getState().nutstore
    if (webdavAutoSync || (s3 && s3.autoSync) || localBackupAutoSync) {
      startAutoSync()
    }
    if (nutstoreAutoSync) {
      startNutstoreAutoSync()
    }
  }, 8000)
}

function initStoreSync() {
  if (isWebRuntime()) {
    return
  }
  storeSyncService.subscribe()
}

function initWebTrace() {
  webTraceService.init()
}

initKeyv()
initAutoSync()
initStoreSync()
initWebTrace()
