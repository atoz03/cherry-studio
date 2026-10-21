import { beforeEach, describe, expect, it, vi } from 'vitest'

const { bootConfigGetMock, setPathMock, usableDirs } = vi.hoisted(() => ({
  bootConfigGetMock: vi.fn(),
  setPathMock: vi.fn(),
  usableDirs: new Set<string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? '/profile' : '/mock/unknown'),
    setPath: setPathMock
  }
}))
vi.mock('@main/data/bootConfig', () => ({
  bootConfigService: { get: bootConfigGetMock }
}))
// Directory probing is covered by userDataLocation's own tests; here only the
// resolution policy matters.
vi.mock('@main/core/preboot/userDataLocation', () => ({
  canonicalizeUserDataPath: (value: string) => value,
  isUsableDataDir: (value: string) => usableDirs.has(value)
}))

import { resolveStorageLocations } from '../storageLocation'

function configure(roots: Record<string, Record<string, string>>) {
  bootConfigGetMock.mockImplementation((key: string) => (key === 'app.storage_paths' ? roots : undefined))
}

describe('resolveStorageLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usableDirs.clear()
  })

  // Bug caught: Chromium only follows a sessionData root set before ready, so
  // a missed setPath silently leaves browser data in userData.
  it("applies this profile's custom roots and points sessionData at its custom root", () => {
    usableDirs.add('/big/models').add('/big/browser')
    configure({
      '/profile': { models: '/big/models', session_data: '/big/browser' },
      '/other-profile': { toolchain: '/big/tools' }
    })

    expect(resolveStorageLocations()).toEqual({ models: '/big/models', session_data: '/big/browser' })
    expect(setPathMock).toHaveBeenCalledWith('sessionData', '/big/browser')
  })

  // Bug caught: an unplugged drive must not make the app create an empty tree
  // where the drive used to be, nor rewrite the user's choice.
  it('falls back to the default for this launch when a custom root is unavailable', () => {
    configure({ '/profile': { toolchain: '/unplugged/tools', session_data: '/unplugged/browser' } })

    expect(resolveStorageLocations()).toEqual({})
    expect(setPathMock).not.toHaveBeenCalled()
  })
})
