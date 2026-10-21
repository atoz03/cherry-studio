import fs from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PathConstants from '@main/core/paths/constants'

const { appSetPathMock, bootConfigGetMock, bootConfigSetMock, cherryHome, renameMock, updateProgressMock } =
  await vi.hoisted(async () => {
    const nodeFs = await import('node:fs')
    const nodeOs = await import('node:os')
    const nodePath = await import('node:path')
    return {
      appSetPathMock: vi.fn(),
      bootConfigGetMock: vi.fn(),
      bootConfigSetMock: vi.fn(),
      // Default home of OVMS; a temp dir so no test touches the real one.
      cherryHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'cherry-storage-home-')),
      renameMock: vi.fn(),
      updateProgressMock: vi.fn()
    }
  })

const TASK_ID = '22222222-2222-4222-8222-222222222222'
let state: Record<string, unknown>
let userData: string

vi.mock('@application', () => ({
  application: {
    getPath: (key: string, filename?: string) => {
      const root = key in state ? String(state[key]) : path.join(String(state.protectedRoot), key)
      return filename ? path.join(root, filename) : root
    }
  }
}))
vi.mock('@main/core/paths/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof PathConstants>()),
  CHERRY_HOME: cherryHome
}))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: {
    get: bootConfigGetMock,
    set: bootConfigSetMock,
    flush: vi.fn(),
    persist: vi.fn()
  }
}))
vi.mock('../window', () => ({
  openUserDataRelocationWindow: () => ({
    waitForReady: () => Promise.resolve(),
    updateProgress: updateProgressMock,
    hasWindow: () => true,
    isUnavailable: () => false,
    close: vi.fn()
  })
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) => (key === 'userData' ? userData : '/mock/exe'),
    setPath: appSetPathMock,
    setAppLogsPath: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined)
  }
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, rename: renameMock, default: { ...actual, rename: renameMock } }
})

const roots: string[] = []

function makeRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-storage-')))
  roots.push(root)
  return root
}

function write(file: string, content = file): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

function exists(target: string): boolean {
  return fs.existsSync(target)
}

function requestMove(scope: 'models' | 'toolchain' | 'session_data', from: string, to: string) {
  state['temp.user_data_relocation'] = { status: 'pending', taskId: TASK_ID, scope, from, to, copy: true }
}

async function runRelocation() {
  const { runUserDataRelocation } = await import('../index')
  return runUserDataRelocation()
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  renameMock.mockImplementation(actual.rename)
  fs.rmSync(path.join(cherryHome, 'ovms'), { recursive: true, force: true })

  userData = makeRoot()
  // The path registry creates these on first lookup.
  fs.mkdirSync(path.join(userData, 'Runtime', 'models'), { recursive: true })
  fs.mkdirSync(path.join(userData, 'Toolchain'))
  state = {
    protectedRoot: makeRoot(),
    'app.userdata': userData,
    'app.session': userData,
    'app.temp': makeRoot(),
    'feature.storage.models': path.join(userData, 'Runtime', 'models'),
    'feature.storage.toolchain': path.join(userData, 'Toolchain'),
    'app.storage_paths': {},
    'temp.user_data_relocation': null
  }
  bootConfigGetMock.mockImplementation((key: string) => state[key])
  bootConfigSetMock.mockImplementation((key: string, value: unknown) => {
    state[key] = value
  })
})

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

afterAll(() => {
  fs.rmSync(cherryHome, { recursive: true, force: true })
})

describe('storage location relocation', () => {
  // Bug caught: Tesseract and OVMS live outside Runtime/models by default and
  // would stay behind, or the new root would never be recorded.
  it('moves every local model, including Tesseract and OVMS, into a custom root and records it', async () => {
    const custom = path.join(makeRoot(), 'models')
    write(path.join(userData, 'Runtime', 'models', 'qwen3-embedding', 'model.bin'), 'embedding')
    write(path.join(userData, 'tesseract', 'eng.traineddata'), 'tesseract')
    write(path.join(cherryHome, 'ovms', 'ovms', 'ovms.exe'), 'ovms')
    requestMove('models', path.join(userData, 'Runtime', 'models'), custom)

    await expect(runRelocation()).resolves.toBe('handled')

    expect(read(path.join(custom, 'qwen3-embedding', 'model.bin'))).toBe('embedding')
    expect(read(path.join(custom, 'tesseract', 'eng.traineddata'))).toBe('tesseract')
    expect(read(path.join(custom, 'ovms', 'ovms', 'ovms.exe'))).toBe('ovms')
    expect(exists(path.join(userData, 'Runtime', 'models'))).toBe(false)
    expect(exists(path.join(userData, 'tesseract'))).toBe(false)
    expect(exists(path.join(cherryHome, 'ovms'))).toBe(false)
    expect(state['app.storage_paths']).toEqual({ [userData]: { models: custom } })
    expect(state['temp.user_data_relocation']).toBeNull()
  })

  // Bug caught: a reset that leaves the profile key behind keeps pointing
  // preboot at the old root, or misplaces the entries with their own homes.
  it('resets local models to their default homes and forgets the custom root', async () => {
    const custom = path.join(makeRoot(), 'models')
    write(path.join(custom, 'qwen3-embedding', 'model.bin'), 'embedding')
    write(path.join(custom, 'tesseract', 'eng.traineddata'), 'tesseract')
    write(path.join(custom, 'ovms', 'ovms.exe'), 'ovms')
    state['feature.storage.models'] = custom
    state['app.storage_paths'] = { [userData]: { models: custom }, '/other/profile': { models: '/elsewhere' } }
    requestMove('models', custom, path.join(userData, 'Runtime', 'models'))

    await expect(runRelocation()).resolves.toBe('handled')

    expect(read(path.join(userData, 'Runtime', 'models', 'qwen3-embedding', 'model.bin'))).toBe('embedding')
    expect(read(path.join(userData, 'tesseract', 'eng.traineddata'))).toBe('tesseract')
    expect(read(path.join(cherryHome, 'ovms', 'ovms.exe'))).toBe('ovms')
    expect(exists(custom)).toBe(false)
    expect(state['app.storage_paths']).toEqual({ '/other/profile': { models: '/elsewhere' } })
  })

  // Bug caught: moving browser data must take only Chromium's entries and leave
  // Cherry Studio's own files (database, logs) in userData.
  it('moves only the Chromium entries of a default sessionData out of userData', async () => {
    const custom = path.join(makeRoot(), 'browser')
    write(path.join(userData, 'Partitions', 'agent-browser', 'Cookies'), 'cookie')
    write(path.join(userData, 'Local Storage', 'leveldb', '000003.log'), 'local')
    write(path.join(userData, 'Data', 'cherrystudio.sqlite'), 'db')
    requestMove('session_data', userData, custom)

    await expect(runRelocation()).resolves.toBe('handled')

    expect(read(path.join(custom, 'Partitions', 'agent-browser', 'Cookies'))).toBe('cookie')
    expect(read(path.join(custom, 'Local Storage', 'leveldb', '000003.log'))).toBe('local')
    expect(read(path.join(userData, 'Data', 'cherrystudio.sqlite'))).toBe('db')
    expect(fs.readdirSync(custom).sort()).toEqual(['Local Storage', 'Partitions'])
    expect(state['app.storage_paths']).toEqual({ [userData]: { session_data: custom } })
  })

  // Bug caught: a cross-volume move that resolves symlinks would point the copy
  // back at the old location, and deleting sources before the commit loses data.
  it('copies across volumes with symlinks kept verbatim and removes the sources after the commit', async () => {
    const source = path.join(userData, 'Toolchain')
    const custom = path.join(makeRoot(), 'tools')
    write(path.join(source, 'mise', 'installs', 'node', '22.0.0', 'bin', 'node'), 'node')
    fs.symlinkSync('22.0.0', path.join(source, 'mise', 'installs', 'node', '22'))
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    renameMock.mockImplementation(async (from: string, to: string) => {
      if (from.startsWith(source + path.sep)) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      return actual.rename(from, to)
    })
    requestMove('toolchain', source, custom)

    await expect(runRelocation()).resolves.toBe('handled')

    const link = path.join(custom, 'mise', 'installs', 'node', '22')
    expect(fs.readlinkSync(link)).toBe('22.0.0')
    expect(read(path.join(link, 'bin', 'node'))).toBe('node')
    expect(exists(source)).toBe(false)
    expect(state['app.storage_paths']).toEqual({ [userData]: { toolchain: custom } })
    expect(updateProgressMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'copying' }))
  })

  // Bug caught: an entry that cannot move must not leave the location split
  // between two roots or record the new one.
  it('rolls every moved entry back and keeps the old location when one entry fails', async () => {
    const source = path.join(userData, 'Toolchain')
    const custom = path.join(makeRoot(), 'tools')
    write(path.join(source, 'a', 'file'), 'a')
    write(path.join(source, 'b', 'file'), 'b')
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    let moved = 0
    renameMock.mockImplementation(async (from: string, to: string) => {
      if (from.startsWith(source + path.sep) && ++moved === 2) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return actual.rename(from, to)
    })
    requestMove('toolchain', source, custom)

    await expect(runRelocation()).resolves.toBe('handled')

    expect(read(path.join(source, 'a', 'file'))).toBe('a')
    expect(read(path.join(source, 'b', 'file'))).toBe('b')
    expect(exists(custom)).toBe(false)
    expect(state['app.storage_paths']).toEqual({})
    expect(state['temp.user_data_relocation']).toMatchObject({ status: 'failed', scope: 'toolchain' })
  })

  // Bug caught: retrying a move cut off by a crash would treat the half-moved
  // location as the full source and lose the entries already at the target.
  it('undoes a move that a previous launch left half done instead of retrying it', async () => {
    const source = path.join(userData, 'Toolchain')
    const custom = path.join(makeRoot(), 'tools')
    write(path.join(custom, 'a', 'file'), 'a')
    write(path.join(source, 'b', 'file'), 'b')
    requestMove('toolchain', source, custom)
    state['temp.user_data_relocation'] = { ...(state['temp.user_data_relocation'] as object), entries: ['a', 'b'] }

    await expect(runRelocation()).resolves.toBe('handled')

    expect(read(path.join(source, 'a', 'file'))).toBe('a')
    expect(read(path.join(source, 'b', 'file'))).toBe('b')
    expect(state['app.storage_paths']).toEqual({})
    expect(state['temp.user_data_relocation']).toMatchObject({ status: 'failed' })
  })
})

describe('storage location request', () => {
  it('rejects a target inside the app data directory', async () => {
    const { inspectStorageRelocationTarget } = await import('../index')

    await expect(inspectStorageRelocationTarget('toolchain', path.join(userData, 'Elsewhere'))).resolves.toEqual({
      valid: false,
      reason: 'target_protected'
    })
  })

  it('rejects a non-empty target so nothing is merged into existing files', async () => {
    const target = makeRoot()
    write(path.join(target, 'keep.txt'), 'keep')
    const { inspectStorageRelocationTarget } = await import('../index')

    await expect(inspectStorageRelocationTarget('models', target)).resolves.toEqual({
      valid: false,
      reason: 'target_not_empty'
    })
  })

  it('refuses a reset while the default home already holds one of the entries', async () => {
    const custom = makeRoot()
    write(path.join(custom, 'Cookies'), 'new')
    write(path.join(userData, 'Cookies'), 'stale')
    state['app.session'] = custom
    const { inspectStorageRelocationTarget } = await import('../index')

    await expect(inspectStorageRelocationTarget('session_data', userData)).resolves.toEqual({
      valid: false,
      reason: 'target_not_empty'
    })
  })

  it('records a pending move that the next launch carries out', async () => {
    const target = path.join(makeRoot(), 'models')
    const { requestStorageRelocation } = await import('../index')

    await requestStorageRelocation('models', target)

    expect(state['temp.user_data_relocation']).toMatchObject({
      status: 'pending',
      scope: 'models',
      from: path.join(userData, 'Runtime', 'models'),
      to: target
    })
  })
})
