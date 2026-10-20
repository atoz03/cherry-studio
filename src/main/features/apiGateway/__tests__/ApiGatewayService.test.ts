import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

/**
 * Exercises `ApiGatewayService`'s reconcile-after-settle convergence: a toggle that
 * lands during an in-flight activation must be honoured (no queue, no dropped opposing
 * toggle), and a persistently failing transition must not spin the loop.
 *
 * The inner `ApiGateway` server is mocked so activation timing is controllable; the
 * preference-change handler is captured so the toggle can be driven directly.
 */

const { mockStart, mockStop, mockGetActiveUsageContext, mockPreferenceSet, captured } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockGetActiveUsageContext: vi.fn(),
  mockPreferenceSet: vi.fn<(key: string, value: boolean | string) => Promise<void>>(),
  captured: {
    prefHandler: undefined as ((enabled: boolean) => void) | undefined,
    enabledPreference: false,
    hostPreference: '127.0.0.1',
    portPreference: 23333
  }
}))

vi.mock('../server', () => ({
  ApiGateway: vi.fn(function ApiGatewayMock(endpoint: { host: string; port: number }) {
    return { start: mockStart, stop: mockStop, isRunning: () => true, getPort: () => endpoint.port }
  })
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      subscribeChange: vi.fn((_key: string, cb: (enabled: boolean) => void) => {
        captured.prefHandler = cb
        return () => {}
      }),
      get: vi.fn((key: string) => (key.endsWith('api_key') ? 'existing-key' : false)),
      getMultiple: vi.fn(() => ({
        enabled: captured.enabledPreference,
        host: captured.hostPreference,
        port: captured.portPreference,
        apiKey: 'existing-key'
      })),
      set: mockPreferenceSet
    },
    CacheService: { setShared: vi.fn() },
    AgentSessionRuntimeService: { getActiveUsageContext: mockGetActiveUsageContext }
  } as any)
})

import { ApiGatewayService } from '../ApiGatewayService'
import { ApiGateway } from '../server'

let startResolvers: Array<() => void>
let rejectStart: boolean

beforeEach(() => {
  BaseService.resetInstances()
  captured.prefHandler = undefined
  captured.enabledPreference = false
  captured.hostPreference = '127.0.0.1'
  captured.portPreference = 23333
  mockPreferenceSet.mockReset()
  mockPreferenceSet.mockImplementation(async (key, value) => {
    if (key === 'feature.api_gateway.enabled') captured.enabledPreference = value as boolean
  })
  startResolvers = []
  rejectStart = false
  mockStart.mockReset()
  mockStop.mockReset()
  mockGetActiveUsageContext.mockReset()
  mockGetActiveUsageContext.mockReturnValue({
    agentSessionId: 'session-1',
    source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
  })
  mockStart.mockImplementation(() =>
    rejectStart
      ? Promise.reject(new Error('port in use'))
      : new Promise<void>((resolve) => startResolvers.push(resolve))
  )
  mockStop.mockResolvedValue(undefined)
})

async function startInternalGateway(service: ApiGatewayService) {
  const pending = service.ensureInternalGateway()
  await vi.waitFor(() => expect(startResolvers.length).toBeGreaterThan(0))
  startResolvers.at(-1)!()
  return pending
}

const CHAT_SCOPE = { path: '/v1/chat/completions', model: 'openai:gpt-4o' }

describe('ApiGatewayService internal gateway', () => {
  it('serves internal consumers from one loopback listener without enabling the user-facing gateway', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const internal = await startInternalGateway(service)
    const scoped = await service.createScopedCredential(CHAT_SCOPE)

    expect(vi.mocked(ApiGateway)).toHaveBeenCalledOnce()
    expect(vi.mocked(ApiGateway)).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0 }, 'internal')
    expect(scoped.baseUrl).toBe(internal.baseUrl)
    expect(service.getInternalGatewayOrigin()).toBe(internal.baseUrl)
    expect(service.isActivated).toBe(false)
    expect(captured.enabledPreference).toBe(false)
  })

  it('retries the internal listener after a failed start', async () => {
    const service = new ApiGatewayService()
    rejectStart = true
    await expect(service.ensureInternalGateway()).rejects.toThrow('port in use')

    rejectStart = false
    await expect(startInternalGateway(service)).resolves.toMatchObject({ baseUrl: expect.any(String) })
    expect(vi.mocked(ApiGateway)).toHaveBeenCalledTimes(2)
  })

  it('recognizes internal credentials in every header dialect and never the user key', async () => {
    const service = new ApiGatewayService()
    const internal = await startInternalGateway(service)
    const scoped = await service.createScopedCredential(CHAT_SCOPE)

    expect(service.isInternalRequest(new Headers({ 'x-api-key': internal.apiKey }))).toBe(true)
    expect(service.isInternalRequest(new Headers({ authorization: `Bearer ${scoped.apiKey}` }))).toBe(true)
    expect(service.isInternalRequest(new Headers({ 'x-goog-api-key': internal.apiKey }))).toBe(true)
    expect(service.isInternalRequest(new Headers({ 'x-api-key': 'existing-key' }))).toBe(false)
    expect(service.isInternalRequest(new Headers())).toBe(false)
  })

  it('binds each scoped credential to its own scope and revokes it on dispose', async () => {
    const service = new ApiGatewayService()
    const internal = await startInternalGateway(service)
    const first = await service.createScopedCredential(CHAT_SCOPE)
    const second = await service.createScopedCredential({ ...CHAT_SCOPE, model: 'openai:gpt-4o-mini' })
    const headers = (apiKey: string) => new Headers({ authorization: `Bearer ${apiKey}` })

    expect(first.apiKey).not.toBe(second.apiKey)
    expect(service.getCredentialScope(headers(first.apiKey))).toEqual(CHAT_SCOPE)
    expect(service.getCredentialScope(headers(second.apiKey))?.model).toBe('openai:gpt-4o-mini')
    expect(service.getCredentialScope(headers(internal.apiKey))).toBeUndefined()

    first.dispose()
    expect(service.isInternalRequest(headers(first.apiKey))).toBe(false)
    expect(service.getCredentialScope(headers(first.apiKey))).toBeUndefined()
    expect(service.isInternalRequest(headers(second.apiKey))).toBe(true)
  })

  it('attributes usage to an Agent session only for the unrestricted internal key', async () => {
    const service = new ApiGatewayService()
    const internal = await startInternalGateway(service)
    const scoped = await service.createScopedCredential(CHAT_SCOPE)
    const sessionHeaders = service.getAgentSessionUsageHeaders('session-1')

    expect(service.resolveAgentSessionUsage(new Headers({ ...sessionHeaders, 'x-api-key': internal.apiKey }))).toEqual({
      agentSessionId: 'session-1',
      source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
    })
    expect(mockGetActiveUsageContext).toHaveBeenCalledWith('session-1')
    expect(service.getAgentSessionId(new Headers({ ...sessionHeaders, 'x-api-key': scoped.apiKey }))).toBeUndefined()
    expect(service.getAgentSessionId(new Headers({ ...sessionHeaders, 'x-api-key': 'existing-key' }))).toBeUndefined()
  })
})

describe('ApiGatewayService reconcile', () => {
  // Regression for #18521: boot used to start the gateway whenever any agent existed, overriding a
  // user who had turned it off — and nothing else may override it either.
  it('stays stopped at boot when the preference is disabled', async () => {
    const service = new ApiGatewayService()

    await service._doInit()

    expect(mockStart).not.toHaveBeenCalled()
    expect(service.isActivated).toBe(false)
  })

  it('starts at boot when the preference is enabled', async () => {
    captured.enabledPreference = true
    const service = new ApiGatewayService()

    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    expect(service.isActivated).toBe(true)
  })

  // A host persisted by an upstream build with Device Connections must never expose the gateway.
  it('listens on loopback even when the persisted host is every interface', async () => {
    captured.enabledPreference = true
    captured.hostPreference = '0.0.0.0'
    const service = new ApiGatewayService()

    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    expect(vi.mocked(ApiGateway)).toHaveBeenCalledWith({ host: '127.0.0.1', port: 23333 })
  })

  // The command and the persisted intent must land together: a stop whose preference write never
  // happened comes back on the next launch, which is the whole of #18521.
  it('persists the intent before converging, and reports a failed persist instead of stopping', async () => {
    captured.enabledPreference = true
    const service = new ApiGatewayService()
    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    mockPreferenceSet.mockRejectedValueOnce(new Error('disk full'))
    await expect(service.stop()).rejects.toThrow('disk full')
    expect(service.isActivated).toBe(true)
  })

  it('persists the intent when a start succeeds', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const started = service.start()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await started

    expect(service.getCurrentConfig().enabled).toBe(true)
    expect(service.isActivated).toBe(true)
  })

  // A re-bind must not resurrect a gateway another window disabled while the restart was queued:
  // that would leave runtime=running with the preference persisted as disabled.
  it('aborts a restart when the gateway was disabled meanwhile', async () => {
    captured.enabledPreference = true
    const service = new ApiGatewayService()
    const ready = service._doInit()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await ready

    // Another window's stop lands: the preference is already persisted when the restart re-reads it.
    captured.enabledPreference = false
    await expect(service.restart()).rejects.toThrow('disabled while restarting')
    expect(service.isActivated).toBe(false)
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it('honors an opposing toggle that lands during an in-flight activation (no dropped toggle)', async () => {
    const service = new ApiGatewayService()
    await service._doInit() // Ready; desiredEnabled=false; reconcile is a no-op.
    expect(service.isActivated).toBe(false)
    expect(captured.prefHandler).toBeDefined()

    // Enable → reconcile starts activating; the inner start() stays pending.
    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false) // still mid-activation

    // Opposing disable lands mid-activation. A queue/short-circuit would drop it;
    // reconcile re-reads the desired state after the activation settles.
    captured.prefHandler!(false)

    // Complete the activation — the loop must now deactivate to converge to `false`.
    startResolvers[0]()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    expect(service.isActivated).toBe(false)
  })

  it('converges to running when the final desired state is enabled', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await vi.waitFor(() => expect(service.isActivated).toBe(true))
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('does not retry a failed activation for a stable desired state (no spin loop)', async () => {
    rejectStart = true
    const service = new ApiGatewayService()
    await service._doInit()

    captured.prefHandler!(true)
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    // Give the loop a chance to (wrongly) retry the same failing target.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(service.isActivated).toBe(false)
  })

  it('converges when a pref change opposes an in-flight direct IPC start (single owner)', async () => {
    // The residual race: a direct IPC start() in flight + an opposing pref change.
    // With start() routed through the same queue, the pref change can't be dropped.
    const service = new ApiGatewayService()
    await service._doInit()

    // Attach the settle handler synchronously so the in-flight rejection (start() ends
    // up !isActivated because desired flipped) is never an unhandled rejection.
    const startSettled = service.start().then(
      () => 'resolved',
      () => 'rejected'
    )
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))

    // Opposing disable lands while the IPC activation is still in flight.
    captured.prefHandler!(false)

    // Complete the activation; the running reconcile must then deactivate to converge.
    startResolvers[0]()
    await vi.waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1))
    await startSettled

    expect(service.isActivated).toBe(false) // converged to desiredEnabled === false
  })
})

describe('ApiGatewayService running-state publication', () => {
  it('returns stopped when stop() deactivates the server immediately', async () => {
    const service = new ApiGatewayService()
    await service._doInit()

    const started = service.start()
    await vi.waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
    startResolvers[0]()
    await started

    await expect(service.stop()).resolves.toBe('stopped')
    expect(service.isActivated).toBe(false)
    expect(mockStop).toHaveBeenCalledTimes(1)
  })
})
