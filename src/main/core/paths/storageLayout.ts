import path from 'node:path'

import type { StorageLocation } from '@shared/types/storageLocation'

import { CHERRY_HOME } from './constants'

/** Custom roots chosen for the relocatable storage locations; absent = default. */
export type StorageRoots = Partial<Record<StorageLocation, string>>

/**
 * Chromium-owned entries of a sessionData directory. While sessionData is the
 * default (userData itself), these are what moves out with it; everything else
 * in userData belongs to Cherry Studio and stays.
 */
export const SESSION_DATA_ENTRIES = [
  'blob_storage',
  'Cache',
  'Code Cache',
  'Cookies',
  'Cookies-journal',
  'databases',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal',
  'DevToolsActivePort',
  'Dictionaries',
  'DIPS',
  'DIPS-journal',
  'DIPS-shm',
  'DIPS-wal',
  'Extension Rules',
  'Extension Scripts',
  'Extension State',
  'File System',
  'GPUCache',
  'GPUPersistentCache',
  'GraphiteDawnCache',
  'GrShaderCache',
  'IndexedDB',
  'Local Extension Settings',
  'Local State',
  'Local Storage',
  'Managed Extension Settings',
  'Network',
  'Network Persistent State',
  'Partitions',
  'Preferences',
  'QuotaManager',
  'QuotaManager-journal',
  'Reporting and NEL',
  'Reporting and NEL-journal',
  'Service Worker',
  'Session Storage',
  'ShaderCache',
  'Shared Dictionary',
  'shared_proto_db',
  'SharedStorage',
  'SharedStorage-wal',
  'Sync Extension Settings',
  'TransportSecurity',
  'Trust Tokens',
  'Trust Tokens-journal',
  'VideoDecodeStats',
  'WebrtcVideoStats',
  'WebStorage'
] as const

/** Default root of a storage location, derived from the profile's userData. */
export function defaultStorageRoot(location: StorageLocation, userData: string): string {
  switch (location) {
    case 'models':
      return path.join(userData, 'Runtime', 'models')
    case 'toolchain':
      return path.join(userData, 'Toolchain')
    case 'session_data':
      return userData
  }
}

/**
 * Model entries whose default home predates the shared models root; a custom
 * models root holds them beside the other models.
 */
export const MODEL_ENTRIES_WITH_OWN_DEFAULT = ['tesseract', 'ovms'] as const

/** Where one entry of a storage location lives under the given root. */
export function storageEntryPath(
  location: StorageLocation,
  customRoot: string | undefined,
  name: string,
  userData: string
): string {
  if (customRoot) return path.join(customRoot, name)
  if (location === 'models' && name === 'tesseract') return path.join(userData, 'tesseract')
  if (location === 'models' && name === 'ovms') return path.join(CHERRY_HOME, 'ovms')
  return path.join(defaultStorageRoot(location, userData), name)
}
