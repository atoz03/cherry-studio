import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as TimersPromises from 'node:timers/promises'

import AdmZip from 'adm-zip'
import { create as createTar } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as OnDemandBinaries from '../onDemandBinaries'
import type { OnDemandBinaryName, OnDemandPackage, OnDemandTool } from '../onDemandManifest'

const { manifest, findExecutableInEnvMock } = vi.hoisted(() => ({
  manifest: {} as Record<string, OnDemandTool>,
  findExecutableInEnvMock: vi.fn()
}))

vi.mock('../onDemandManifest', () => ({ onDemandBinaryManifest: manifest }))
vi.mock('@main/utils/commandResolver', () => ({ findExecutableInEnv: findExecutableInEnvMock }))
// Retry backoff is not under test; waiting it out would only slow the suite.
vi.mock('node:timers/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof TimersPromises>()),
  setTimeout: vi.fn(async () => undefined)
}))

const PLATFORM = `${process.platform}-${process.arch}`
const isWin = process.platform === 'win32'

let root: string
let binDir: string
let gitDir: string
let archives: Map<string, Buffer>
// Fresh per test: the module keeps per-session download state.
let mod: typeof OnDemandBinaries
let fetchMock: ReturnType<typeof vi.fn>
let setGithubMirror: (mirror: string) => Promise<void>

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function tarGz(entries: Record<string, string>): Promise<Buffer> {
  const src = await mkdtemp(path.join(root, 'tar-src-'))
  for (const [entry, content] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(src, entry)), { recursive: true })
    await writeFile(path.join(src, entry), content)
  }
  const file = path.join(root, `${path.basename(src)}.tgz`)
  await createTar({ gzip: true, file, cwd: src }, [Object.keys(entries)[0].split('/')[0]])
  return readFile(file)
}

function zip(entries: Record<string, string>): Buffer {
  const archive = new AdmZip()
  for (const [entry, content] of Object.entries(entries)) archive.addFile(entry, Buffer.from(content))
  return archive.toBuffer()
}

/** Publishes `bytes` at a GitHub release URL and pins `name` to it for this platform. */
function pin(name: OnDemandBinaryName, version: string, pkg: Omit<OnDemandPackage, 'url' | 'sha256'>, bytes: Buffer) {
  const url = `https://github.com/example/${name}/releases/download/v${version}/${name}-${PLATFORM}`
  archives.set(url, bytes)
  manifest[name] = {
    version,
    versionFile: `.${name}-version`,
    packages: { [PLATFORM]: { ...pkg, url, sha256: sha256(bytes) } }
  }
  return url
}

function serveArchives() {
  fetchMock.mockImplementation(async (url: string) => {
    const bytes = archives.get(url)
    return bytes ? new Response(new Uint8Array(bytes)) : new Response('not found', { status: 404 })
  })
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'on-demand-binaries-'))
  binDir = path.join(root, 'bin')
  gitDir = path.join(root, 'Toolchain', 'mingit')
  await mkdir(binDir, { recursive: true })
  archives = new Map()
  for (const key of Object.keys(manifest)) delete manifest[key]
  findExecutableInEnvMock.mockReset().mockResolvedValue(null)

  vi.resetModules()
  const { application } = await import('@application')
  vi.mocked(application.getPath).mockImplementation((key: string) => {
    if (key === 'cherry.bin') return binDir
    if (key === 'feature.binary.mingit') return gitDir
    throw new Error(`unexpected path ${key}`)
  })
  const preferences = application.get('PreferenceService')
  setGithubMirror = (githubMirror) =>
    preferences.set('feature.binary.install_settings', {
      ...preferences.get('feature.binary.install_settings'),
      githubMirror
    })
  await setGithubMirror('')
  const { net } = await import('electron')
  fetchMock = vi.mocked(net.fetch)
  fetchMock.mockReset()
  serveArchives()
  mod = await import('../onDemandBinaries')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function expectNothingInstalled(dir = binDir) {
  expect(await readdir(dir).catch(() => [])).toEqual([])
}

function expectExecutable(file: string) {
  if (!isWin) expect(statSync(file).mode & 0o111).not.toBe(0)
}

describe('ensureOnDemandBinary', () => {
  it('installs only the listed binaries from a tar.gz release, with the version marker', async () => {
    const url = pin(
      'uv',
      '0.11.16',
      { archive: 'tar.gz', binaries: ['uv', 'uvx'] },
      await tarGz({ 'uv-release/uv': 'uv-binary', 'uv-release/uvx': 'uvx-binary', 'uv-release/README.md': 'docs' })
    )

    const uv = await mod.ensureOnDemandBinary('uv')

    expect(uv).toBe(path.join(binDir, 'uv'))
    expect(await readFile(uv, 'utf8')).toBe('uv-binary')
    expect(await readFile(path.join(binDir, 'uvx'), 'utf8')).toBe('uvx-binary')
    expectExecutable(uv)
    expect(await readFile(path.join(binDir, '.uv-version'), 'utf8')).toBe('0.11.16')
    expect((await readdir(binDir)).sort()).toEqual(['.uv-version', 'uv', 'uvx'])
    expect(fetchMock.mock.calls.map(([fetched]) => fetched)).toEqual([url])
  })

  it('installs a binary from a directory inside a zip release', async () => {
    pin(
      'bun',
      '1.4.2',
      { archive: 'zip', binaries: ['bun'], strip: 'bun-platform' },
      zip({ 'bun-platform/bun': 'bun-binary', 'bun-platform/LICENSE': 'license' })
    )

    const bun = await mod.ensureOnDemandBinary('bun')

    expect(await readFile(bun, 'utf8')).toBe('bun-binary')
    expectExecutable(bun)
    expect((await readdir(binDir)).sort()).toEqual(['.bun-version', 'bun'])
  })

  it('installs a release that is the bare executable', async () => {
    pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))

    const mise = await mod.ensureOnDemandBinary('mise')

    expect(await readFile(mise, 'utf8')).toBe('mise-binary')
    expectExecutable(mise)
    expect(await readFile(path.join(binDir, '.mise-version'), 'utf8')).toBe('2026.7.14')
  })

  it('installs a whole MinGit tree into its own toolchain directory', async () => {
    pin(
      'mingit',
      '2.54.0',
      { archive: 'zip-tree', dir: 'git', binaries: ['git/cmd/git.exe'] },
      zip({ 'cmd/git.exe': 'git-binary', 'mingw64/bin/git-remote-https.exe': 'helper' })
    )

    const git = await mod.ensureOnDemandBinary('mingit')

    expect(git).toBe(path.join(gitDir, 'git', 'cmd', 'git.exe'))
    expect(await readFile(git, 'utf8')).toBe('git-binary')
    expect(existsSync(path.join(gitDir, 'git', 'mingw64', 'bin', 'git-remote-https.exe'))).toBe(true)
    expect(await readFile(path.join(gitDir, '.mingit-version'), 'utf8')).toBe('2.54.0')
    await expectNothingInstalled()
  })

  it('reuses an installed copy of the pinned version without touching the network', async () => {
    pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))
    await writeFile(path.join(binDir, 'mise'), 'already-here')
    await writeFile(path.join(binDir, '.mise-version'), '2026.7.14\n')

    expect(await mod.ensureOnDemandBinary('mise')).toBe(path.join(binDir, 'mise'))
    expect(await readFile(path.join(binDir, 'mise'), 'utf8')).toBe('already-here')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shares one download between concurrent callers', async () => {
    pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))

    const results = await Promise.all([
      mod.ensureOnDemandBinary('mise'),
      mod.ensureOnDemandBinary('mise'),
      mod.ensureOnDemandBinary('mise')
    ])

    expect(new Set(results)).toEqual(new Set([path.join(binDir, 'mise')]))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('replaces a copy left by an older pin', async () => {
    pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('new-mise'))
    await writeFile(path.join(binDir, 'mise'), 'old-mise')
    await writeFile(path.join(binDir, '.mise-version'), '2025.1.0')

    await mod.ensureOnDemandBinary('mise')

    expect(await readFile(path.join(binDir, 'mise'), 'utf8')).toBe('new-mise')
    expect(await readFile(path.join(binDir, '.mise-version'), 'utf8')).toBe('2026.7.14')
  })

  it('discards a download whose checksum does not match the pin', async () => {
    const url = pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))
    archives.set(url, Buffer.from('tampered'))

    await expect(mod.ensureOnDemandBinary('mise')).rejects.toThrow(/mise 2026\.7\.14 failed its checksum check/)

    await expectNothingInstalled()
    // The same bytes would come back; a retry cannot help.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient server error on the same source', async () => {
    pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 }))

    expect(await readFile(await mod.ensureOnDemandBinary('mise'), 'utf8')).toBe('mise-binary')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('explains an offline failure after retrying, leaving nothing behind', async () => {
    pin('uv', '0.11.16', { archive: 'tar.gz', binaries: ['uv'] }, await tarGz({ 'uv-release/uv': 'uv-binary' }))
    fetchMock.mockRejectedValue(new TypeError('net::ERR_INTERNET_DISCONNECTED'))

    const failure = mod.ensureOnDemandBinary('uv')

    await expect(failure).rejects.toThrow(/Couldn't download uv 0\.11\.16: the download server is unreachable/)
    await expect(failure).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    await expectNothingInstalled()
  })

  it('reports a missing release asset without retrying it', async () => {
    const url = pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))
    archives.delete(url)

    await expect(mod.ensureOnDemandBinary('mise')).rejects.toThrow(/Couldn't download mise 2026\.7\.14 \(HTTP 404/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tries the GitHub mirror first and falls back to github.com', async () => {
    const url = pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))
    await setGithubMirror('https://mirror.example/')

    await mod.ensureOnDemandBinary('mise')

    expect(fetchMock.mock.calls.map(([fetched]) => fetched)).toEqual([`https://mirror.example/${url}`, url])
    expect(await readFile(path.join(binDir, 'mise'), 'utf8')).toBe('mise-binary')
  })

  it('downloads through a working GitHub mirror', async () => {
    const url = pin('mise', '2026.7.14', { archive: 'none', binaries: ['mise'] }, Buffer.from('mise-binary'))
    archives.set(`https://mirror.example/${url}`, archives.get(url)!)
    await setGithubMirror('https://mirror.example')

    await mod.ensureOnDemandBinary('mise')

    expect(fetchMock.mock.calls.map(([fetched]) => fetched)).toEqual([`https://mirror.example/${url}`])
  })

  it('keeps using an older copy when its update cannot be downloaded, without retrying every call', async () => {
    pin(
      'bun',
      '1.4.2',
      { archive: 'zip', binaries: ['bun'], strip: 'bun-platform' },
      zip({ 'bun-platform/bun': 'new' })
    )
    await writeFile(path.join(binDir, 'bun'), 'old-bun')
    await writeFile(path.join(binDir, '.bun-version'), '1.3.0')
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    expect(await mod.ensureOnDemandBinary('bun')).toBe(path.join(binDir, 'bun'))
    const attempts = fetchMock.mock.calls.length
    expect(await mod.ensureOnDemandBinary('bun')).toBe(path.join(binDir, 'bun'))

    expect(fetchMock).toHaveBeenCalledTimes(attempts)
    expect(await readFile(path.join(binDir, 'bun'), 'utf8')).toBe('old-bun')
    expect(await readFile(path.join(binDir, '.bun-version'), 'utf8')).toBe('1.3.0')
  })

  it('refuses a tool with no release for this platform', async () => {
    manifest.mingit = { version: '2.54.0', versionFile: '.mingit-version', packages: {} }

    expect(mod.isOnDemandBinarySupported('mingit')).toBe(false)
    await expect(mod.ensureOnDemandBinary('mingit')).rejects.toThrow(`mingit is not available for ${PLATFORM}.`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('isOnDemandBinarySupported', () => {
  it('covers only pinned tools with a release for this platform', () => {
    pin('uv', '0.11.16', { archive: 'none', binaries: ['uv'] }, Buffer.from('uv'))

    expect(mod.isOnDemandBinarySupported('uv')).toBe(true)
    expect(mod.isOnDemandBinarySupported('rg')).toBe(false)
    expect(mod.isOnDemandBinarySupported('toString')).toBe(false)
  })
})

describe('ensureGitAvailable', () => {
  beforeEach(() => {
    pin(
      'mingit',
      '2.54.0',
      { archive: 'zip-tree', dir: 'git', binaries: ['git/cmd/git.exe'] },
      zip({ 'cmd/git.exe': 'git-binary' })
    )
  })

  it("prefers the user's git and downloads nothing", async () => {
    findExecutableInEnvMock.mockResolvedValue('/usr/bin/git')

    expect(await mod.ensureGitAvailable()).toBe('/usr/bin/git')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads MinGit when no git is installed', async () => {
    expect(await mod.ensureGitAvailable()).toBe(path.join(gitDir, 'git', 'cmd', 'git.exe'))
  })

  it('has no fallback where MinGit has no release', async () => {
    manifest.mingit.packages = {}

    expect(await mod.ensureGitAvailable()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
