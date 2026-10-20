import type * as os from 'node:os'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { remoteLimits } from '@cherrystudio/remote-protocol'
import type { RemoteSocket } from '@cherrystudio/remote-transport'
import { BaseService } from '@main/core/lifecycle'

const state = vi.hoisted(() => ({ loaded: new Set<string>(), publications: 0, address: '192.168.1.8' }))
// A mock factory runs on first import, so a package missing from `state.loaded` was never loaded.
const factories = vi.hoisted(() => ({
  transport: () => {
    state.loaded.add('transport')
    return {
      RemoteRpcError: class extends Error {},
      RemoteRpcServer: class {},
      RemoteSocketStream: class {},
      // The handshake never settles: each test owns the connection's lifetime through its socket.
      acceptSecureChannel: () => new Promise(() => {}),
      deviceIdentityId: () => '12D3KooWDesktop'
    }
  },
  bonjour: () => {
    state.loaded.add('bonjour')
    return {
      default: class {
        publish() {
          state.publications++
          return { on() {}, destroyed: false }
        }
        unpublishAll(done: () => void) {
          done()
        }
        destroy() {}
      }
    }
  }
}))

// Exercises upstream remote access; the fork ships it switched off (see forkFeatures.ts).
vi.mock('@shared/utils/forkFeatures', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FORK_REMOTE_ACCESS_ENABLED: true
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@data/services/RemoteCommandService', () => ({ remoteCommandService: { interruptPending: vi.fn() } }))
vi.mock('../deviceIdentity', () => ({ loadDesktopIdentity: async () => new Uint8Array(32) }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  networkInterfaces: () => ({ en0: [{ address: state.address, family: 'IPv4', internal: false }] })
}))
vi.mock('@cherrystudio/remote-transport', factories.transport)
vi.mock('bonjour-service', factories.bonjour)

import { RemoteAccessService } from '../RemoteAccessService'

function fakeSocket() {
  const closeListeners: Array<() => void> = []
  return {
    binaryType: 'blob',
    bufferedAmount: 0,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => {
      for (const listener of closeListeners.splice(0)) listener()
    }),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'close') closeListeners.push(listener)
    },
    removeEventListener: vi.fn()
  }
}
const asSocket = (socket: ReturnType<typeof fakeSocket>) => socket as unknown as RemoteSocket

describe('RemoteAccessService timers', () => {
  let service: RemoteAccessService
  const presenceOwners = () => vi.mocked(application.get('AttachmentPresenceService').owners)

  // Loaded once up front so fake intervals never race the first runtime import.
  beforeAll(() => import('../remoteRuntime'))
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.api_gateway.enabled': true,
      'feature.api_gateway.host': '0.0.0.0'
    })
    state.publications = 0
    state.address = '192.168.1.8'
    presenceOwners().mockReturnValue([])
    service = new RemoteAccessService()
    await service._doInit()
  })
  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
  })

  it('keeps no timer while there is no endpoint and no connection', async () => {
    expect(vi.getTimerCount()).toBe(0)
    service.updateDirectEndpoint(undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('republishes changed interfaces only while the LAN endpoint is published', async () => {
    service.updateDirectEndpoint({ port: 23333 })
    expect(vi.getTimerCount()).toBe(2)
    await vi.waitFor(() => expect(state.publications).toBe(1))

    state.address = '192.168.1.9'
    await vi.advanceTimersByTimeAsync(5000)
    expect(state.publications).toBe(2)

    service.closeIngress()
    state.address = '192.168.1.10'
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state.publications).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sweeps a live connection, closes it at the pairing deadline, then stops sweeping', async () => {
    await service.prepareIngress()
    const socket = fakeSocket()
    service.accept(asSocket(socket), '192.168.1.20')
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(remoteLimits.invitationMs)
    expect(socket.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.close).toHaveBeenCalledWith(1008, 'Remote session expired')

    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps sweeping while an attachment selection outlives its connection', async () => {
    await service.prepareIngress()
    const socket = fakeSocket()
    service.accept(asSocket(socket), '192.168.1.20')
    presenceOwners().mockReturnValue(['["remote-agent","phone","grant","key"]'])
    socket.close()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(vi.getTimerCount()).toBe(1)
    presenceOwners().mockReturnValue([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps sweeping while a session journal is retained for replay', async () => {
    await service.prepareIngress()
    const idle = vi.spyOn(service['runtime']!.hub, 'idle', 'get').mockReturnValue(false)
    const socket = fakeSocket()
    service.accept(asSocket(socket), '192.168.1.20')
    socket.close()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(vi.getTimerCount()).toBe(1)
    idle.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('RemoteAccessService lazy runtime', () => {
  it('loads neither the transport nor Bonjour until remote access is first used', async () => {
    // A fresh module graph whose mock factories have not run yet.
    vi.resetModules()
    vi.doMock('@cherrystudio/remote-transport', factories.transport)
    vi.doMock('bonjour-service', factories.bonjour)
    state.loaded.clear()
    const { RemoteAccessService: FreshRemoteAccessService } = await import('../RemoteAccessService')
    const service = new FreshRemoteAccessService()
    await service._doInit()

    expect(service.pendingClaims()).toEqual([])
    service.decidePairing('claim', null)
    service.closeIngress()
    expect(state.loaded).toEqual(new Set())

    await service.prepareIngress()
    expect(state.loaded).toEqual(new Set(['transport', 'bonjour']))
    await service._doStop()
  })
})
