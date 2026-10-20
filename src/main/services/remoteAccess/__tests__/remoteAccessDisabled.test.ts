import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RemoteSocket } from '@cherrystudio/remote-transport'
import { BaseService } from '@main/core/lifecycle'

/** The fork's real switch (off): none of the remote stack may load, listen, advertise or pair. */

const loaded = vi.hoisted(() => new Set<string>())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
// A mock factory runs on first import, so a module missing from `loaded` was never loaded.
vi.mock('@cherrystudio/remote-transport', () => {
  loaded.add('transport')
  return {}
})
vi.mock('bonjour-service', () => {
  loaded.add('bonjour')
  return {}
})
vi.mock('../remoteRuntime', () => {
  loaded.add('runtime')
  return {}
})

import { RemoteAccessService } from '../RemoteAccessService'

describe('remote access switched off', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts no timer, offers no pairing and never loads the transport or Bonjour', async () => {
    vi.useFakeTimers()
    BaseService.resetInstances()
    // A LAN configuration persisted by an upstream build must not revive the feature.
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.api_gateway.enabled': true,
      'feature.api_gateway.host': '0.0.0.0'
    })
    const service = new RemoteAccessService()
    await service._doInit()
    expect(vi.getTimerCount()).toBe(0)

    expect(service.pendingClaims()).toEqual([])
    expect(() => service.decidePairing('claim', ['agent'])).not.toThrow()
    await expect(service.createInvitation()).rejects.toThrow('Device connections are disabled in this build')
    await expect(service.prepareIngress()).rejects.toThrow('Device connections are disabled in this build')

    const socket = { close: vi.fn() }
    service.accept(socket as unknown as RemoteSocket, '192.168.1.20')
    expect(socket.close).toHaveBeenCalledWith(1008, 'Remote access is disabled')

    service.closeIngress()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(vi.getTimerCount()).toBe(0)
    expect(loaded).toEqual(new Set())
    await service._doStop()
  })
})
