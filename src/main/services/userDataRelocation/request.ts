import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { loggerService } from '@logger'
import { canonicalizeUserDataPath } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import type { StorageLocation } from '@shared/types/storageLocation'
import type { UserDataRelocationInspection } from '@shared/types/userDataRelocation'

import { assertStorageRelocationPaths, assertStorageRelocationSpace, currentStorageRoot } from './storage'
import type { PendingRelocation } from './types'
import { assertRelocationPaths, assertUserDataRelocationRequest, RelocationValidationError } from './validation'

const logger = loggerService.withContext('UserDataRelocation')

/**
 * Validate a proposed relocation target against the current userData
 * directory without mutating anything. Safe to call repeatedly while the
 * user is still picking a path.
 */
export function inspectUserDataRelocationTarget(targetPath: string): UserDataRelocationInspection {
  try {
    const { targetEmpty } = assertRelocationPaths(application.getPath('app.userdata'), targetPath)
    return { valid: true, targetEmpty }
  } catch (error) {
    if (error instanceof RelocationValidationError) {
      return { valid: false, reason: error.reason }
    }
    throw error
  }
}

/**
 * Record a pending relocation for the next launch. Validation runs against
 * the live filesystem now, but the copy/switch itself happens in
 * runUserDataRelocation() after relaunch, once the source tree is quiescent.
 */
export function requestUserDataRelocation(targetPath: string, copy: boolean): void {
  const pending: PendingRelocation = {
    status: 'pending',
    taskId: uuidv4(),
    from: canonicalizeUserDataPath(application.getPath('app.userdata')),
    to: canonicalizeUserDataPath(targetPath),
    copy
  }
  assertUserDataRelocationRequest(pending)
  persistRelocationRequest(pending)
}

/**
 * Validate moving a storage location to `targetPath` (its default root resets
 * it) without mutating anything, including the free-space check for a move
 * that has to copy across volumes.
 */
export async function inspectStorageRelocationTarget(
  location: StorageLocation,
  targetPath: string
): Promise<UserDataRelocationInspection> {
  try {
    const from = currentStorageRoot(location)
    assertStorageRelocationPaths(location, from, targetPath)
    await assertStorageRelocationSpace(location, from, targetPath)
    return { valid: true, targetEmpty: true }
  } catch (error) {
    if (error instanceof RelocationValidationError) {
      return { valid: false, reason: error.reason }
    }
    throw error
  }
}

/** Record a pending storage move; the data moves on the next launch. */
export async function requestStorageRelocation(location: StorageLocation, targetPath: string): Promise<void> {
  const pending: PendingRelocation = {
    status: 'pending',
    taskId: uuidv4(),
    scope: location,
    from: canonicalizeUserDataPath(currentStorageRoot(location)),
    to: canonicalizeUserDataPath(targetPath),
    copy: true
  }
  assertStorageRelocationPaths(location, pending.from, pending.to)
  await assertStorageRelocationSpace(location, pending.from, pending.to)
  persistRelocationRequest(pending)
}

function persistRelocationRequest(pending: PendingRelocation): void {
  // Temporary BootConfig values bypass PreferenceService. Persist immediately
  // because the request must be durable before Electron relaunches.
  const previous = bootConfigService.get('temp.user_data_relocation')
  bootConfigService.set('temp.user_data_relocation', pending)
  try {
    bootConfigService.persist()
  } catch (error) {
    // persist() intentionally retains dirty in-memory state for retry. This
    // request was rejected, so restore the state a later flush may persist.
    bootConfigService.set('temp.user_data_relocation', previous)
    throw error
  }
  logger.info('userData relocation requested; relaunch required', pending)
}
