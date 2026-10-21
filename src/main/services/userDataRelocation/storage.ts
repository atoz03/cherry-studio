import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  defaultStorageRoot,
  MODEL_ENTRIES_WITH_OWN_DEFAULT,
  SESSION_DATA_ENTRIES,
  storageEntryPath
} from '@main/core/paths/storageLayout'
import { storagePathsKey } from '@main/core/preboot/storageLocation'
import { canonicalizeUserDataPath } from '@main/core/preboot/userDataLocation'
import { bootConfigService } from '@main/data/bootConfig'
import { STORAGE_LOCATIONS, type StorageLocation, type StorageLocationInfo } from '@shared/types/storageLocation'
import type { RelocationProgress } from '@shared/types/userDataRelocation'

import type { PendingRelocation } from './types'
import {
  assertEnoughFreeSpace,
  assertRelocationPaths,
  invalid,
  isErrno,
  isPathInside,
  normalizeForCompare,
  pathEntryExists,
  relocationArtifactPaths,
  resolveEffectivePath,
  resolveExistingAncestor
} from './validation'

/**
 * Storage-location relocation: moving one of the user-relocatable storage roots
 * (local models, downloaded tools, Chromium sessionData) to another directory.
 * It rides the userData relocation flow — same request state, dedicated launch,
 * progress window, failed state — and differs only in what moves: the entries of
 * one root, each renamed when source and target share a volume and copied
 * otherwise. Sources of copies are deleted only after the commit.
 */

const logger = loggerService.withContext('StorageRelocation')

type StorageRelocation = PendingRelocation & { scope: StorageLocation }

interface StorageMove {
  source: string
  target: string
}

/** The root this launch resolved for a location: its custom root or its default. */
export function currentStorageRoot(location: StorageLocation): string {
  switch (location) {
    case 'models':
      return application.getPath('feature.storage.models')
    case 'toolchain':
      return application.getPath('feature.storage.toolchain')
    case 'session_data':
      return application.getPath('app.session')
  }
}

export function storageDefaultRoot(location: StorageLocation): string {
  return defaultStorageRoot(location, application.getPath('app.userdata'))
}

function samePath(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right)
}

function isDefaultRoot(location: StorageLocation, root: string): boolean {
  return samePath(root, storageDefaultRoot(location))
}

function entryPath(location: StorageLocation, root: string, name: string): string {
  const customRoot = isDefaultRoot(location, root) ? undefined : root
  return storageEntryPath(location, customRoot, name, application.getPath('app.userdata'))
}

/** Names of the entries a move of `location` carries out of `root`. */
function listStorageEntries(location: StorageLocation, root: string): string[] {
  const userData = application.getPath('app.userdata')
  if (location === 'session_data' && isDefaultRoot(location, root)) {
    return SESSION_DATA_ENTRIES.filter((name) => pathEntryExists(path.join(userData, name)))
  }
  const names = readDirectoryNames(root).filter((name) => !name.includes('.cherry-relocation-'))
  if (location === 'models' && isDefaultRoot(location, root)) {
    names.push(...MODEL_ENTRIES_WITH_OWN_DEFAULT.filter((name) => pathEntryExists(entryPath(location, root, name))))
  }
  return names
}

function readDirectoryNames(directory: string): string[] {
  try {
    return fs.readdirSync(directory)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return []
    throw error
  }
}

function planMoves(location: StorageLocation, from: string, to: string, entries: readonly string[]): StorageMove[] {
  return entries.map((name) => ({ source: entryPath(location, from, name), target: entryPath(location, to, name) }))
}

/** Size without following symlinks: a move carries links, not their targets. */
async function entryBytes(target: string): Promise<number> {
  let stat: fs.Stats
  try {
    stat = await fsp.lstat(target)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return 0
    throw error
  }
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const child of await fsp.readdir(target)) total += await entryBytes(path.join(target, child))
  return total
}

async function totalBytes(paths: readonly string[]): Promise<number> {
  let total = 0
  for (const target of paths) total += await entryBytes(target)
  return total
}

function isEmptyDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

function isSameVolume(source: string, target: string): boolean {
  return fs.statSync(source).dev === fs.statSync(resolveExistingAncestor(target).path).dev
}

/** Paths, sizes and defaults of every storage location, for the settings page. */
export async function listStorageLocations(): Promise<StorageLocationInfo[]> {
  return Promise.all(
    STORAGE_LOCATIONS.map(async (location) => {
      const root = currentStorageRoot(location)
      let bytes: number | null = null
      try {
        bytes = await totalBytes(listStorageEntries(location, root).map((name) => entryPath(location, root, name)))
      } catch (error) {
        logger.warn('Could not measure storage location', { location, root, error })
      }
      return {
        location,
        path: root,
        defaultPath: storageDefaultRoot(location),
        isDefault: isDefaultRoot(location, root),
        bytes
      }
    })
  )
}

/**
 * Validate a storage move without touching the filesystem. A custom target must
 * be a missing or empty directory clear of userData and of every storage root
 * (see assertRelocationPaths); moving back to the default only requires that
 * nothing already occupies the default homes of the entries being moved.
 */
export function assertStorageRelocationPaths(location: StorageLocation, from: string, to: string): void {
  if (samePath(from, to)) invalid('same_path', `source and target are the same path: ${to}`)
  if (isDefaultRoot(location, to)) {
    for (const move of planMoves(location, from, to, listStorageEntries(location, from))) {
      if (pathEntryExists(move.target) && !isEmptyDirectory(move.target)) {
        invalid('target_not_empty', `the default location already holds ${move.target}`)
      }
    }
    return
  }

  const { targetEmpty } = assertRelocationPaths(from, to)
  if (!targetEmpty) invalid('target_not_empty', `target must be empty: ${to}`)

  // assertRelocationPaths rejects overlap with every storage root; userData is
  // only among them while it doubles as sessionData.
  const target = normalizeForCompare(resolveEffectivePath(to))
  const userData = normalizeForCompare(resolveEffectivePath(application.getPath('app.userdata')))
  if (target === userData || isPathInside(target, userData) || isPathInside(userData, target)) {
    invalid('target_protected', `target overlaps the app data directory: ${to}`)
  }
}

/** Request-time space check; a same-volume move is a rename and needs none. */
export async function assertStorageRelocationSpace(location: StorageLocation, from: string, to: string) {
  if (isSameVolume(from, to)) return
  const sources = listStorageEntries(location, from).map((name) => entryPath(location, from, name))
  await assertEnoughFreeSpace(to, await totalBytes(sources))
}

/**
 * Launch-time execution of a pending storage move. The entry list is journaled
 * into the request before the first rename, so a launch that finds it already
 * journaled knows the previous attempt was interrupted: it undoes that attempt
 * and fails instead of guessing which half is complete.
 */
export async function executeStorageRelocation(
  pending: StorageRelocation,
  publish: (progress: RelocationProgress) => void,
  commit: () => void
): Promise<void> {
  if (pending.entries) {
    const leftovers = await undoInterruptedStorageMove(pending, pending.entries)
    throw new Error(
      leftovers.length > 0
        ? `the previous move was interrupted and has been undone; remove these duplicate copies before retrying: ${leftovers.join(', ')}`
        : 'the previous move was interrupted and has been undone'
    )
  }

  assertStorageRelocationPaths(pending.scope, pending.from, pending.to)
  const entries = listStorageEntries(pending.scope, pending.from)
  journalEntries(pending, entries)

  const moves = planMoves(pending.scope, pending.from, pending.to, entries)
  const createdRoot = !pathEntryExists(pending.to)
  const done: Array<StorageMove & { copied: boolean }> = []
  try {
    // The root must exist even when nothing moves: preboot ignores a missing one.
    await fsp.mkdir(pending.to, { recursive: true })
    const copies: StorageMove[] = []
    for (const move of moves) {
      // Path lookups auto-create empty default directories; those hold nothing.
      if (isEmptyDirectory(move.target)) await fsp.rmdir(move.target)
      await fsp.mkdir(path.dirname(move.target), { recursive: true })
      try {
        await fsp.rename(move.source, move.target)
        done.push({ ...move, copied: false })
      } catch (error) {
        if (!isErrno(error, 'EXDEV')) throw error
        copies.push(move)
      }
    }

    if (copies.length > 0) {
      const total = await totalBytes(copies.map((move) => move.source))
      await assertEnoughFreeSpace(pending.to, total)
      let copied = 0
      let publishedPercent = -1
      const onFile = (bytes: number) => {
        copied = Math.min(copied + bytes, total)
        const percent = total > 0 ? Math.floor((copied / total) * 100) : 100
        if (percent === publishedPercent) return
        publishedPercent = percent
        publish(progress(pending, copied, total))
      }
      onFile(0)
      for (const move of copies) {
        await copyEntry(move, pending.taskId, onFile)
        done.push({ ...move, copied: true })
      }
    }

    commit()
  } catch (error) {
    const rollbackError = await rollbackStorageMove(done, createdRoot ? pending.to : null)
    if (!rollbackError) throw error
    const original = error instanceof Error ? error.message : String(error)
    throw new Error(`${original}; rollback failed: ${rollbackError.message}`)
  }

  for (const move of done) {
    if (!move.copied) continue
    await fsp.rm(move.source, { recursive: true, force: true }).catch((error) => {
      logger.warn('Could not remove a moved entry from its old location', { source: move.source, error })
    })
  }
  if (!samePath(pending.from, application.getPath('app.userdata'))) {
    await fsp.rmdir(pending.from).catch(() => undefined)
  }
}

function journalEntries(pending: StorageRelocation, entries: string[]): void {
  bootConfigService.set('temp.user_data_relocation', { ...pending, entries })
  try {
    bootConfigService.persist()
  } catch (error) {
    bootConfigService.set('temp.user_data_relocation', pending)
    throw error
  }
}

async function copyEntry(move: StorageMove, taskId: string, onFile: (bytes: number) => void): Promise<void> {
  const { workPath } = relocationArtifactPaths(move.target, taskId)
  try {
    // Symlinks stay verbatim: toolchains link inside themselves, and resolving
    // them would point the copy back at the old location.
    await fsp.cp(move.source, workPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
      filter: async (source) => {
        const stat = await fsp.lstat(source)
        if (!stat.isDirectory()) onFile(stat.size)
        return true
      }
    })
    await fsp.rename(workPath, move.target)
  } catch (error) {
    await fsp.rm(workPath, { recursive: true, force: true }).catch((cleanupError) => {
      logger.warn('Could not remove a partial storage copy', { workPath, error: cleanupError })
    })
    throw error
  }
}

/**
 * Reverse completed moves: renamed entries go back, copies are deleted (their
 * sources were never touched). Returns the rollback error instead of throwing so
 * the caller can report both failures.
 */
async function rollbackStorageMove(
  done: ReadonlyArray<StorageMove & { copied: boolean }>,
  createdRoot: string | null
): Promise<Error | null> {
  try {
    for (const move of [...done].reverse()) {
      if (move.copied) await fsp.rm(move.target, { recursive: true, force: true })
      else await fsp.rename(move.target, move.source)
    }
    if (createdRoot) await fsp.rmdir(createdRoot).catch(() => undefined)
    return null
  } catch (error) {
    logger.error('Failed to roll back storage move', { error })
    return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Restore the pre-move state from the journal: drop this task's partial copies
 * and rename moved entries back (only a rename leaves the source gone). An entry
 * present at both ends is a finished copy that was never committed; its source
 * is still authoritative and the copy is reported rather than deleted.
 */
async function undoInterruptedStorageMove(pending: StorageRelocation, entries: readonly string[]): Promise<string[]> {
  logger.warn('Undoing an interrupted storage move', { scope: pending.scope, from: pending.from, to: pending.to })
  const leftovers: string[] = []
  for (const move of planMoves(pending.scope, pending.from, pending.to, entries)) {
    await fsp.rm(relocationArtifactPaths(move.target, pending.taskId).workPath, { recursive: true, force: true })
    const hasSource = pathEntryExists(move.source)
    const hasTarget = pathEntryExists(move.target)
    if (!hasSource && hasTarget) await fsp.rename(move.target, move.source)
    else if (hasSource && hasTarget && !isEmptyDirectory(move.target)) leftovers.push(move.target)
  }
  return leftovers
}

/**
 * Point the location at its new root after the move. Moving back to the default
 * removes the custom root; the request is cleared in the same strict persist,
 * and a failed persist restores both values so a later flush cannot record a
 * root whose move the caller rolls back.
 */
export function commitStorageLocation(location: StorageLocation, root: string): void {
  const key = storagePathsKey()
  const current = bootConfigService.get('app.storage_paths')
  const relocation = bootConfigService.get('temp.user_data_relocation')
  const roots = { ...current[key] }
  if (isDefaultRoot(location, root)) delete roots[location]
  else roots[location] = canonicalizeUserDataPath(root)
  const next = { ...current }
  if (Object.keys(roots).length > 0) next[key] = roots
  else delete next[key]

  bootConfigService.set('app.storage_paths', next)
  bootConfigService.set('temp.user_data_relocation', null)
  try {
    bootConfigService.persist()
  } catch (error) {
    bootConfigService.set('app.storage_paths', current)
    bootConfigService.set('temp.user_data_relocation', relocation)
    throw error
  }
  logger.info('Storage location committed', { location, root })
}

function progress(pending: StorageRelocation, bytesCopied: number, bytesTotal: number): RelocationProgress {
  return { stage: 'copying', from: pending.from, to: pending.to, bytesCopied, bytesTotal }
}
