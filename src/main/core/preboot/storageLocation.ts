import path from 'node:path'

import { app } from 'electron'

import { loggerService } from '@logger'
import type { StorageRoots } from '@main/core/paths/storageLayout'
import { canonicalizeUserDataPath, isUsableDataDir } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { STORAGE_LOCATIONS } from '@shared/types/storageLocation'

const logger = loggerService.withContext('Preboot')

/** The `app.storage_paths` key of the profile this launch resolved. */
export function storagePathsKey(): string {
  return canonicalizeUserDataPath(app.getPath('userData'))
}

/**
 * Resolve the custom storage roots for this profile before the path registry
 * is frozen. A custom sessionData root is applied here, before app.whenReady(),
 * so every Chromium session follows it; the models and toolchain roots are
 * returned for the registry. The `services/userDataRelocation` domain moves the
 * data and commits `app.storage_paths`; this only reads it.
 *
 * An unusable root (e.g. an unplugged drive) falls back to the default for this
 * launch without touching BootConfig, mirroring resolveUserDataLocation().
 */
export function resolveStorageLocations(): StorageRoots {
  const configured = bootConfigService.get('app.storage_paths')[storagePathsKey()] ?? {}
  const roots: StorageRoots = {}
  for (const location of STORAGE_LOCATIONS) {
    const root = configured[location]
    if (!root) continue
    if (!path.isAbsolute(root) || !isUsableDataDir(root)) {
      logger.warn('Custom storage location is unavailable; using the default for this launch', { location, root })
      continue
    }
    roots[location] = root
  }
  if (roots.session_data) app.setPath('sessionData', roots.session_data)
  if (Object.keys(roots).length > 0) logger.info('Custom storage locations applied', roots)
  return roots
}
