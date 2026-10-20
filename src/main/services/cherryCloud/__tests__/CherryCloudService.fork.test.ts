import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentialsRead: vi.fn(),
  loopbackOpen: vi.fn(),
  netFetch: vi.fn(),
  openExternal: vi.fn()
}))

vi.mock('../CherryAccountCredentialStore', () => ({
  cherryAccountCredentialStore: {
    get: () => {
      mocks.credentialsRead()
      return {
        version: 1,
        devicePublicKey: 'public-key',
        devicePrivateKey: 'private-key',
        session: {
          apiOrigin: 'http://127.0.0.1:8084',
          refreshToken: 'refresh-token',
          sessionId: 'session-id',
          sessionExpiresAt: Date.now() + 3_600_000,
          deviceId: 'device-id',
          accountId: 'account-id',
          displayName: 'Saved account'
        }
      }
    },
    replace: vi.fn(),
    clearSession: vi.fn()
  }
}))

vi.mock('../CherryCloudLoopbackCallback', () => ({
  CherryCloudLoopbackCallback: { open: mocks.loopbackOpen }
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '2.1.8', isPackaged: false },
  net: { fetch: mocks.netFetch },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { BaseService } from '@main/core/lifecycle'

import { CherryCloudLoginUnavailableError, CherryCloudService } from '../CherryCloudService'

beforeEach(() => {
  BaseService.resetInstances()
  vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_API_ORIGIN', 'http://127.0.0.1:8084')
  vi.stubEnv('MAIN_VITE_CHERRY_CLOUD_CLIENT_SECRET', 'cloud-secret')
})

describe('CherryCloudService with FORK_CHERRY_CLOUD_ENABLED off', () => {
  it('starts signed out without restoring saved credentials or contacting the cloud', async () => {
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.getStatus()).resolves.toEqual({ phase: 'signed-out', accountId: null, displayName: null })
    await expect(service.syncEntitledModelsIfStale()).resolves.toMatchObject({ entitledModelIds: [] })
    expect(mocks.credentialsRead).not.toHaveBeenCalled()
    expect(mocks.netFetch).not.toHaveBeenCalled()
  })

  it('refuses to start a login before opening a callback port, a browser, or a request', async () => {
    const service = new CherryCloudService()
    await service._doInit()

    await expect(service.startLogin()).rejects.toBeInstanceOf(CherryCloudLoginUnavailableError)
    expect(mocks.loopbackOpen).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.netFetch).not.toHaveBeenCalled()
  })
})
