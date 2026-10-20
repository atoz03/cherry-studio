import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { setTimeout as sleep } from 'node:timers/promises'

import { net } from 'electron'
import StreamZip from 'node-stream-zip'
import { extract as extractTar } from 'tar'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { t } from '@main/i18n'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { assertZipEntriesWithin } from '@main/utils/zipSafety'
import { BINARY_INSTALL_PREFERENCE_KEY } from '@shared/data/presets/binaryTools'

import { type OnDemandBinaryName, onDemandBinaryManifest, type OnDemandPackage } from './onDemandManifest'

/**
 * Cherry's own copies of mise, bun, uv and (Windows) MinGit. They used to ship in
 * every installer; now each is downloaded the first time a flow needs it, verified
 * against the checksum pinned at build time, and installed where the bundled copy
 * used to be extracted — so every existing lookup (`cherry.bin`, bundledGit) finds it.
 */

const logger = loggerService.withContext('onDemandBinaries')

// A transfer that delivers nothing for this long is dead; a slow but moving one continues.
const STALL_TIMEOUT_MS = 30_000
const ATTEMPTS_PER_SOURCE = 3
const RETRY_DELAY_MS = 1_000

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string
  ) {
    super(`HTTP ${status} for ${url}`)
  }
}

class IntegrityError extends Error {}

const inFlight = new Map<OnDemandBinaryName, Promise<void>>()
// An outdated copy whose update failed this session is used without retrying on every call.
const updateDeferred = new Set<OnDemandBinaryName>()

function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

function currentPackage(name: OnDemandBinaryName): OnDemandPackage | undefined {
  return onDemandBinaryManifest[name]?.packages[platformKey()]
}

/** Whether Cherry can download its own copy of `name` on this platform. */
export function isOnDemandBinarySupported(name: string): name is OnDemandBinaryName {
  return Object.hasOwn(onDemandBinaryManifest, name) && currentPackage(name as OnDemandBinaryName) !== undefined
}

function installRoot(name: OnDemandBinaryName): string {
  return name === 'mingit' ? application.getPath('feature.binary.mingit') : application.getPath('cherry.bin')
}

function installedFiles(name: OnDemandBinaryName, pkg: OnDemandPackage): string[] {
  return pkg.binaries.map((binary) => path.join(installRoot(name), binary))
}

function installedVersion(name: OnDemandBinaryName): string | null {
  try {
    return (
      fs.readFileSync(path.join(installRoot(name), onDemandBinaryManifest[name].versionFile), 'utf8').trim() || null
    )
  } catch {
    return null
  }
}

/**
 * Path to Cherry's copy of `name`, downloading the pinned version first when it
 * is missing or outdated. Concurrent callers share one download. A copy from an
 * older pin stays in use when the update cannot be fetched; with no copy at all
 * the rejection explains why the download failed.
 */
export async function ensureOnDemandBinary(name: OnDemandBinaryName): Promise<string> {
  const { version } = onDemandBinaryManifest[name]
  const pkg = currentPackage(name)
  if (!pkg) throw new Error(t('binary.download.unsupported', { tool: name, platform: platformKey() }))
  const files = installedFiles(name, pkg)
  const present = () => files.every((file) => fs.existsSync(file))
  if (present() && (installedVersion(name) === version || updateDeferred.has(name))) return files[0]

  let pending = inFlight.get(name)
  if (!pending) {
    pending = install(name, pkg).finally(() => inFlight.delete(name))
    inFlight.set(name, pending)
  }
  try {
    await pending
  } catch (error) {
    if (!present()) throw error
    updateDeferred.add(name)
    logger.warn(`Keeping the installed ${name}; ${version} could not be installed`, { error: String(error) })
  }
  return files[0]
}

/**
 * The git a flow that needs one should run: the user's own first; on Windows
 * without one, Cherry's MinGit, downloaded on first use. Null where Cherry has
 * no fallback (macOS and Linux without git).
 */
export async function ensureGitAvailable(): Promise<string | null> {
  const found = await findExecutableInEnv('git')
  if (found || !isOnDemandBinarySupported('mingit')) return found
  return ensureOnDemandBinary('mingit')
}

async function install(name: OnDemandBinaryName, pkg: OnDemandPackage): Promise<void> {
  const { version, versionFile } = onDemandBinaryManifest[name]
  const root = installRoot(name)
  // Inside the install root so every commit is a same-volume rename; a fixed name
  // lets the next attempt clear whatever an interrupted one left behind.
  const staging = path.join(root, `.download-${name}`)
  const archive = path.join(staging, 'archive')
  const unpacked = path.join(staging, 'unpacked')
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.mkdir(unpacked, { recursive: true })
  try {
    logger.info(`Downloading ${name} ${version}`, { url: pkg.url })
    await download(name, version, pkg, archive)
    await unpack(archive, pkg, unpacked)
    await commit(unpacked, pkg, root)
    // Marker last: a reader that sees the new version finds every file in place.
    await fsp.writeFile(path.join(staging, versionFile), version)
    await fsp.rename(path.join(staging, versionFile), path.join(root, versionFile))
    logger.info(`Installed ${name} ${version}`, { root })
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch((error) => {
      logger.warn(`Could not remove the ${name} download staging directory`, { error: String(error) })
    })
  }
}

async function download(name: OnDemandBinaryName, version: string, pkg: OnDemandPackage, dest: string) {
  let lastError: unknown
  for (const url of downloadUrls(pkg.url)) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_SOURCE; attempt++) {
      try {
        await fetchVerified(url, dest, pkg.sha256)
        return
      } catch (error) {
        lastError = error
        logger.warn(`Download of ${name} failed (attempt ${attempt})`, { url, error: String(error) })
        // Wrong bytes or a missing asset will not change on retry; another source might differ.
        const permanent =
          error instanceof IntegrityError ||
          (error instanceof HttpStatusError && error.status < 500 && error.status !== 429)
        if (permanent) break
        if (attempt < ATTEMPTS_PER_SOURCE) await sleep(RETRY_DELAY_MS * attempt)
      }
    }
  }
  const params = { tool: name, version, detail: lastError instanceof Error ? lastError.message : String(lastError) }
  const message =
    lastError instanceof IntegrityError
      ? t('binary.download.integrity_failed', params)
      : lastError instanceof HttpStatusError
        ? t('binary.download.http_failed', params)
        : t('binary.download.network_failed', params)
  throw new Error(message, { cause: lastError })
}

/** The user's GitHub mirror first when one is set — github.com being unreachable is why it exists. */
function downloadUrls(url: string): string[] {
  const mirror = application.get('PreferenceService').get(BINARY_INSTALL_PREFERENCE_KEY).githubMirror.trim()
  if (!mirror || !url.startsWith('https://github.com/')) return [url]
  try {
    const parsed = new URL(mirror)
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return [`${parsed.toString().replace(/\/$/, '')}/${url}`, url]
    }
  } catch {
    // reported below
  }
  logger.warn('Ignoring an invalid GitHub mirror for binary downloads')
  return [url]
}

async function fetchVerified(url: string, dest: string, sha256: string): Promise<void> {
  const stall = new AbortController()
  let timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, { signal: stall.signal })
    if (!response.ok || !response.body) throw new HttpStatusError(response.status, url)
    const hash = createHash('sha256')
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        clearTimeout(timer)
        timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS)
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    // net.fetch's body is the DOM ReadableStream; Readable.fromWeb wants the
    // node:stream/web flavour — same runtime object, divergent lib types.
    const body = response.body as unknown as NodeWebReadableStream<Uint8Array>
    await pipeline(Readable.fromWeb(body), meter, fs.createWriteStream(dest), { signal: stall.signal })
    const digest = hash.digest('hex')
    if (digest !== sha256) throw new IntegrityError(`sha256 mismatch for ${url}: expected ${sha256}, got ${digest}`)
  } finally {
    clearTimeout(timer)
  }
}

async function unpack(archive: string, pkg: OnDemandPackage, outDir: string): Promise<void> {
  if (pkg.archive === 'none') {
    await fsp.rename(archive, path.join(outDir, pkg.binaries[0]))
  } else if (pkg.archive === 'tar.gz') {
    // Release tarballs wrap everything in one top-level directory and carry docs we do not ship.
    const wanted = new Set(pkg.binaries)
    await extractTar({
      file: archive,
      cwd: outDir,
      strip: 1,
      filter: (entryPath) => wanted.has(entryPath.split('/').slice(1).join('/'))
    })
  } else {
    const zip = new StreamZip.async({ file: archive })
    try {
      if (pkg.archive === 'zip-tree') {
        const treeDir = path.join(outDir, pkg.dir!)
        await fsp.mkdir(treeDir, { recursive: true })
        assertZipEntriesWithin(Object.keys(await zip.entries()), treeDir)
        await zip.extract(null, treeDir)
      } else {
        for (const binary of pkg.binaries) {
          await zip.extract(pkg.strip ? `${pkg.strip}/${binary}` : binary, path.join(outDir, binary))
        }
      }
    } finally {
      await zip.close()
    }
  }
  for (const binary of pkg.binaries) {
    const file = path.join(outDir, binary)
    if (!fs.existsSync(file)) throw new Error(`${binary} is missing from ${pkg.url}`)
    if (!isWin) await fsp.chmod(file, 0o755)
  }
}

/** Same-volume renames, so no reader ever sees a half-written file. */
async function commit(unpacked: string, pkg: OnDemandPackage, root: string): Promise<void> {
  if (!pkg.dir) {
    for (const binary of pkg.binaries) await fsp.rename(path.join(unpacked, binary), path.join(root, binary))
    return
  }
  const tree = path.join(root, pkg.dir)
  const retired = path.join(root, `.retired-${pkg.dir}`)
  await fsp.rm(retired, { recursive: true, force: true })
  const hadPrevious = fs.existsSync(tree)
  // A Windows process still running the old tree makes this rename fail, leaving it intact.
  if (hadPrevious) await fsp.rename(tree, retired)
  try {
    await fsp.rename(path.join(unpacked, pkg.dir), tree)
  } catch (error) {
    if (hadPrevious) await fsp.rename(retired, tree)
    throw error
  }
  await fsp.rm(retired, { recursive: true, force: true }).catch((error) => {
    logger.warn('Could not remove the replaced MinGit tree', { error: String(error) })
  })
}
