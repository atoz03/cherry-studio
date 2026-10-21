/**
 * Storage locations the user can move out of userData. Each one holds data that
 * can grow large: downloaded local models, downloaded tools, and all Chromium
 * browser state (Electron sessionData).
 */
export const STORAGE_LOCATIONS = ['models', 'toolchain', 'session_data'] as const

export type StorageLocation = (typeof STORAGE_LOCATIONS)[number]

export interface StorageLocationInfo {
  location: StorageLocation
  path: string
  defaultPath: string
  isDefault: boolean
  /** Bytes the location currently holds; null when it could not be measured. */
  bytes: number | null
}
