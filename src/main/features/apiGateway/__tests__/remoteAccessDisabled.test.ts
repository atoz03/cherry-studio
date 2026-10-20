import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { node } from '@elysia/node'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

/** The fork's real switch (off): the gateway never opens a LAN listener or a remote upgrade route. */

const listeners = vi.hoisted(() => [] as Array<{ host: string; port: number }>)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  const preferences = MockMainPreferenceServiceExport.preferenceService
  return mockApplicationFactory({
    PreferenceService: {
      ...preferences,
      getMultiple: (keys: Record<string, UnifiedPreferenceKeyType>) =>
        Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, preferences.get(key)]))
    },
    RemoteAccessService: {
      updateDirectEndpoint: vi.fn(),
      closeIngress: vi.fn(),
      createInvitation: vi.fn(),
      prepareIngress: vi.fn(async () => {}),
      accept: vi.fn()
    }
  } as never)
})
vi.mock('../server', () => ({
  ApiGateway: vi.fn(function ApiGatewayMock(endpoint: { host: string; port: number }) {
    const listener = { ...endpoint }
    listeners.push(listener)
    return {
      start: async () => {},
      stop: async () => {},
      isRunning: () => true,
      getPort: () => listener.port,
      getHost: () => listener.host,
      getHosts: () => [listener.host],
      rebind: async (host: string) => {
        listener.host = host
      }
    }
  })
}))

import { ApiGatewayService } from '../ApiGatewayService'
import { REMOTE_CONNECT_PATH, remoteRoutes } from '../routes/remote'

const remoteAccess = () => application.get('RemoteAccessService')

describe('API gateway with remote access switched off', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    listeners.length = 0
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    // A LAN configuration persisted by an upstream build.
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.api_gateway.enabled': true,
      'feature.api_gateway.host': '0.0.0.0',
      'feature.api_gateway.port': 23333,
      'feature.api_gateway.api_key': 'existing-key'
    })
  })

  it('keeps a persisted LAN configuration on loopback and never publishes a discovery endpoint', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    expect(service.isRunning()).toBe(true)
    expect(listeners).toEqual([{ host: '127.0.0.1', port: 23333 }])
    expect(vi.mocked(remoteAccess().updateDirectEndpoint).mock.calls).toEqual([[undefined]])
    expect(application.get('CacheService').setShared).toHaveBeenCalledWith('feature.api_gateway.lan_running', false)
    await service._doDestroy()
  })

  it('refuses to open LAN access or create a pairing invitation', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '127.0.0.1')
    const service = new ApiGatewayService()
    await service._doInit()

    await expect(service.setLanEnabled(true)).rejects.toThrow('Device connections are disabled in this build')
    expect(service.getCurrentConfig().host).toBe('127.0.0.1')
    await expect(service.createRemoteInvitation()).rejects.toThrow('Device connections are disabled')
    expect(remoteAccess().createInvitation).not.toHaveBeenCalled()
    await service._doDestroy()
  })

  it('does not mount the remote WebSocket upgrade route', async () => {
    const app = new Elysia({ adapter: node() }).use(remoteRoutes)
    type Info = { raw?: { ready?: () => Promise<unknown>; node?: { server?: Server } } }
    const info = await new Promise<Info>((resolve) => app.listen({ port: 0, hostname: '127.0.0.1' }, resolve))
    await info.raw?.ready?.()
    const http = info.raw?.node?.server
    if (!http) throw new Error('Expected Node HTTP server')
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${(http.address() as AddressInfo).port}${REMOTE_CONNECT_PATH}`)
      const outcome = await new Promise<string>((resolve) => {
        socket.once('open', () => {
          socket.terminate()
          resolve('upgraded')
        })
        socket.once('error', (error) => resolve(error.message))
      })
      expect(outcome).toBe('Unexpected server response: 404')
      expect(remoteAccess().prepareIngress).not.toHaveBeenCalled()
      expect(remoteAccess().accept).not.toHaveBeenCalled()
    } finally {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  })
})
