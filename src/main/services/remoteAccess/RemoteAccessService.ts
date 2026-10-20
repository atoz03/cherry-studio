import { powerMonitor } from 'electron'

import { application } from '@application'
import { isUploadChunk } from '@cherrystudio/remote-protocol'
import { remoteLimits, type RemoteCapability } from '@cherrystudio/remote-protocol'
import type { ChannelOptions, RemoteSocket } from '@cherrystudio/remote-transport'
import { agentSessionService } from '@data/services/AgentSessionService'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { RemoteConnection } from './RemoteConnection'
import type { RemoteRuntime } from './remoteRuntime'

const logger = loggerService.withContext('RemoteAccessService')
const transportLog: ChannelOptions['logger'] = {
  forComponent: () =>
    Object.assign(() => {}, {
      enabled: false,
      trace() {},
      error: (formatter: unknown, ...args: unknown[]) =>
        logger.warn('Encrypted remote transport error', { detail: String(formatter), args: args.map(String) }),
      newScope: () => transportLog.forComponent('remote')
    })
}

@Injectable('RemoteAccessService')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'AiStreamManager',
  'AgentSessionRuntimeService',
  'FileManager',
  'FileIntakeService',
  'AttachmentPresenceService'
])
export class RemoteAccessService extends BaseService {
  private identity?: Promise<Uint8Array>
  /** Transport, mDNS, pairing and journal state; loaded on first real use (endpoint, invitation or upgrade). */
  private runtime?: RemoteRuntime
  private runtimeLoading?: Promise<RemoteRuntime>
  private endpoint?: { port: number; ipv6?: boolean; identity?: string }
  private endpointRevision = 0
  /** Armed only while discovery is published. */
  private advertisementTimer: Disposable | null = null
  /** Armed while there is an endpoint, a connection, or remote state that outlives one. */
  private sweepTimer: Disposable | null = null
  private readonly connections = new Map<
    RemoteSocket,
    { address: string; openedAt: number; abort: AbortController; remote?: RemoteConnection }
  >()

  protected async onInit(): Promise<void> {
    remoteCommandService.interruptPending()
    this.registerDisposable(
      agentSessionService.onSessionUpdated(({ sessionId }) => this.runtime?.hub.publishSession(sessionId))
    )
    const refreshAdvertisement = () => this.refreshAdvertisement()
    powerMonitor.on('resume', refreshAdvertisement)
    this.registerDisposable(() => powerMonitor.removeListener('resume', refreshAdvertisement))
    this.registerDisposable(() => {
      this.updateDirectEndpoint(undefined)
      this.runtime?.pairing.clear()
      this.runtime?.tokens.clear()
      this.runtime?.hub.dispose()
      for (const socket of this.connections.keys()) socket.close(1001, 'Service stopping')
    })
  }

  protected onStop(): void {
    this.closeIngress()
    // Both timers are auto-disposed after onStop; null'd so a restart re-arms them.
    this.advertisementTimer = null
    this.sweepTimer = null
  }

  /** Gateway pushes its actual listener; temporary local API leases never enable discovery. */
  updateDirectEndpoint(endpoint: { port: number; ipv6?: boolean } | undefined): void {
    if (this.endpoint?.port === endpoint?.port && this.endpoint?.ipv6 === endpoint?.ipv6) return
    const revision = ++this.endpointRevision
    this.endpoint = endpoint
    this.runtime?.advertisement.stop()
    if (!endpoint) {
      this.advertisementTimer?.dispose()
      this.advertisementTimer = null
      application.get('CacheService').setShared('feature.remote_access.discovery_status', 'inactive')
      return
    }
    this.advertisementTimer ??= this.registerInterval(() => this.refreshAdvertisement(), 5000)
    this.armSweep()
    application.get('CacheService').setShared('feature.remote_access.discovery_status', 'starting')
    const advertised = endpoint
    void this.getIdentity()
      .then(({ runtime, identity }) => {
        if (revision !== this.endpointRevision) return
        const desktopIdentity = runtime.deviceIdentityId(identity)
        this.endpoint = { ...advertised, identity: desktopIdentity }
        runtime.advertisement.update(desktopIdentity, advertised.port, advertised.ipv6)
      })
      .catch((error: unknown) => {
        if (revision !== this.endpointRevision) return
        application.get('CacheService').setShared('feature.remote_access.discovery_status', 'unavailable')
        logger.warn('Remote identity unavailable for discovery', error as Error)
      })
  }

  async getConnectionEndpoints() {
    const { runtime, identity } = await this.getIdentity()
    const desktopIdentity = runtime.deviceIdentityId(identity)
    const { addresses, port } = await application.get('ApiGatewayService').getRemoteEndpoint()
    return { desktopIdentity, endpoints: addresses.map((host) => ({ host, port, security: 'ws' as const })) }
  }

  async createInvitation() {
    const { runtime, identity } = await this.getIdentity()
    const desktopIdentity = runtime.deviceIdentityId(identity)
    if (this.endpoint && !this.endpoint.identity) {
      this.endpoint.identity = desktopIdentity
      runtime.advertisement.update(this.endpoint.identity, this.endpoint.port, this.endpoint.ipv6)
    }
    return { ...runtime.pairing.create(), desktopIdentity, protocolVersions: [1] }
  }

  pendingClaims() {
    return this.runtime?.pairing.pending() ?? []
  }
  decidePairing(claimId: string, capabilities: RemoteCapability[] | null): void {
    // Claims only exist once an invitation loaded the runtime; without it there is nothing to decide.
    if (!this.runtime) return
    this.runtime.pairing.decide(claimId, capabilities)
    application.get('IpcApiService').broadcast('api_gateway.remote.pairing_changed', undefined)
  }

  /**
   * Loads the transport before the gateway's ws route completes an upgrade: the stream must listen
   * synchronously in {@link accept}, or the peer's first handshake frame could arrive unheard.
   */
  async prepareIngress(): Promise<void> {
    await this.loadRuntime()
  }

  /** Called by the gateway's ws route once the upgrade completed; refuses beyond the connection budget. */
  accept(socket: RemoteSocket, address: string): void {
    const preferences = application.get('PreferenceService')
    const runtime = this.runtime
    if (
      !runtime ||
      !preferences.get('feature.api_gateway.enabled') ||
      preferences.get('feature.api_gateway.host') !== '0.0.0.0'
    ) {
      socket.close(1008, 'Remote access is disabled')
      return
    }
    const sameAddress = [...this.connections.values()].filter((value) => value.address === address).length
    if (this.connections.size >= 32 || sameAddress >= 4) {
      socket.close(1013, 'Too many remote connections')
      return
    }
    socket.binaryType = 'arraybuffer'
    const entry = {
      address,
      openedAt: Date.now(),
      abort: new AbortController(),
      remote: undefined as RemoteConnection | undefined
    }
    this.connections.set(socket, entry)
    this.armSweep()
    socket.addEventListener('close', () => {
      entry.abort.abort()
      entry.remote?.dispose()
      this.connections.delete(socket)
    })
    void this.run(runtime, socket, entry).catch((error: unknown) => {
      if (entry.abort.signal.aborted && error === entry.abort.signal.reason) return
      logger.warn('Remote session ended with an error', { address, error: (error as Error).message })
      socket.close(1011, 'Remote session failed')
    })
  }

  /** The LAN listener is going away: pending invitations and live sessions go with it. */
  closeIngress(): void {
    this.updateDirectEndpoint(undefined)
    this.runtime?.pairing.clear()
    for (const socket of this.connections.keys()) socket.close(1001, 'Gateway stopping')
  }

  /** A disabled build never loads the transport or mDNS modules. */
  private loadRuntime(): Promise<RemoteRuntime> {
    this.runtimeLoading ??= import('./remoteRuntime')
      .then(({ createRemoteRuntime }) => {
        this.runtime ??= createRemoteRuntime((status) =>
          application.get('CacheService').setShared('feature.remote_access.discovery_status', status)
        )
        return this.runtime
      })
      .catch((error: unknown) => {
        this.runtimeLoading = undefined
        throw error
      })
    return this.runtimeLoading
  }

  private async getIdentity(): Promise<{ runtime: RemoteRuntime; identity: Uint8Array }> {
    const runtime = await this.loadRuntime()
    this.identity ??= runtime.loadDesktopIdentity().catch((error: unknown) => {
      this.identity = undefined
      throw error
    })
    return { runtime, identity: await this.identity }
  }

  private refreshAdvertisement(): void {
    if (this.endpoint?.identity)
      this.runtime?.advertisement.update(this.endpoint.identity, this.endpoint.port, this.endpoint.ipv6)
  }

  private armSweep(): void {
    this.sweepTimer ??= this.registerInterval(() => this.sweep(), 1000)
  }

  private sweep(): void {
    // Journals and attachment selections outlive their connection; keep sweeping until they are gone.
    if (
      !this.endpoint &&
      !this.connections.size &&
      (this.runtime?.hub.idle ?? true) &&
      !application.get('AttachmentPresenceService').owners().length
    ) {
      this.sweepTimer?.dispose()
      this.sweepTimer = null
      return
    }
    this.runtime?.tokens.sweep()
    this.runtime?.hub.sweep()
    for (const [socket, entry] of this.connections) {
      try {
        entry.remote?.sweep()
        if (!entry.remote?.isAuthenticated() && Date.now() - entry.openedAt > remoteLimits.invitationMs)
          throw new Error('Pairing timeout')
      } catch {
        socket.close(1008, 'Remote session expired')
      }
    }
  }

  private async run(
    runtime: RemoteRuntime,
    socket: RemoteSocket,
    entry: { abort: AbortController; remote?: RemoteConnection }
  ): Promise<void> {
    const stream = new runtime.RemoteSocketStream(socket, transportLog.forComponent('remote'), 'inbound')
    const channel = await runtime.acceptSecureChannel(stream, {
      identity: (await this.getIdentity()).identity,
      logger: transportLog,
      protocolVersions: [1],
      signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(10_000)])
    })
    const remote = new runtime.RemoteConnection(
      channel,
      runtime.pairing,
      runtime.tokens,
      () => application.get('IpcApiService').broadcast('api_gateway.remote.pairing_changed', undefined),
      runtime.hub,
      () => this.getConnectionEndpoints()
    )
    entry.remote = remote
    let windowStart = Date.now()
    let count = 0
    let uploadCount = 0
    while (!entry.abort.signal.aborted) {
      const input = await channel.read(entry.abort.signal)
      if (isUploadChunk(input)) {
        void remote.receiveUpload(input).catch(() => socket.close(1011, 'Remote upload failed'))
        continue
      }
      if (Date.now() - windowStart >= 1000) {
        windowStart = Date.now()
        count = 0
        uploadCount = 0
      }
      const upload =
        input !== null && typeof input === 'object' && 'method' in input && input.method === 'agent.content.read'
      if (upload ? ++uploadCount > 512 : ++count > 256) {
        // Awaiting keeps a flood of refusals from queueing ahead of the socket; excess must not end the session.
        const refusal = remote.rpc.refuse(input, {
          reason: 'RATE_LIMITED',
          message: 'Request rate exceeded',
          retryAfterMs: Math.max(1, windowStart + 1000 - Date.now())
        })
        if (refusal) await remote.send(refusal).catch(() => socket.close(1011, 'Remote request failed'))
        continue
      }
      void remote.rpc
        .receive(input, undefined)
        .then(async (response) => {
          if (response !== null) await remote.send(response)
        })
        .catch(() => socket.close(1011, 'Remote request failed'))
    }
  }
}
