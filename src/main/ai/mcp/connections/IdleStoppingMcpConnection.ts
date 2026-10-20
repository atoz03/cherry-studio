import type { CacheMode } from '@modelcontextprotocol/client'

import type {
  McpCallToolOptions,
  McpConnection,
  McpForwardMethod,
  McpForwardOptions,
  McpRequestOptions,
  McpResourceObservation,
  McpResourceObservationState
} from './McpConnection'

export type IdleStoppingState = 'idle' | 'connecting' | 'connected' | 'error'

export interface IdleStoppingMcpConnectionOptions {
  idleMs: number
  /** Starts a fresh server process after an idle stop. */
  reconnect: (signal: AbortSignal) => Promise<McpConnection>
  onStateChange: (state: IdleStoppingState, error?: unknown) => void
}

/**
 * Stops a stdio server's process once it has had no request in flight and no resource observation
 * open for `idleMs`, and starts it again on the next request. Metadata keeps the last connection's
 * values while stopped, so cache-only readers (capabilities, instructions, version) are unaffected.
 *
 * Trade-off: a server that keeps session state only in memory (a REPL kernel, a non-persistent
 * browser) loses it after the idle window; the next call runs against a fresh process.
 */
export class IdleStoppingMcpConnection implements McpConnection {
  private live: McpConnection | undefined
  private last: McpConnection
  private restarting: Promise<McpConnection> | undefined
  private readonly lifetime = new AbortController()
  private busy = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    connection: McpConnection,
    private readonly options: IdleStoppingMcpConnectionOptions
  ) {
    this.live = connection
    this.last = connection
    this.armIdleTimer()
  }

  get era() {
    return this.last.era
  }

  get serverVersion() {
    return this.last.serverVersion
  }

  get serverCapabilities() {
    return this.last.serverCapabilities
  }

  get instructions() {
    return this.last.instructions
  }

  listTools(cacheMode?: CacheMode) {
    return this.use((connection) => connection.listTools(cacheMode))
  }

  callTool(name: string, args: unknown, options: McpCallToolOptions) {
    return this.use((connection) => connection.callTool(name, args, options))
  }

  forwardRequest(method: McpForwardMethod, params: Record<string, unknown>, options: McpForwardOptions) {
    return this.use((connection) => connection.forwardRequest(method, params, options))
  }

  listPrompts(cacheMode?: CacheMode) {
    return this.use((connection) => connection.listPrompts(cacheMode))
  }

  getPrompt(name: string, args?: Record<string, string>, options?: McpRequestOptions) {
    return this.use((connection) => connection.getPrompt(name, args, options))
  }

  listResources(cacheMode?: CacheMode) {
    return this.use((connection) => connection.listResources(cacheMode))
  }

  listResourceTemplates(cacheMode?: CacheMode) {
    return this.use((connection) => connection.listResourceTemplates(cacheMode))
  }

  readResource(uri: string, cacheMode?: CacheMode, options?: McpRequestOptions) {
    return this.use((connection) => connection.readResource(uri, cacheMode, options))
  }

  /** A stopped server is restarted here: the runtime probes health before every reuse. */
  health() {
    return this.use((connection) => connection.health())
  }

  observeResource(uri: string, onState: (state: McpResourceObservationState) => void): McpResourceObservation {
    if (!this.live) throw new Error('MCP server is stopped; reconnect before observing resources')
    const observation = this.live.observeResource(uri, onState)
    this.begin()
    let open = true
    return {
      close: async () => {
        if (!open) return observation.close()
        open = false
        try {
          await observation.close()
        } finally {
          this.end()
        }
      }
    }
  }

  async close(): Promise<void> {
    this.lifetime.abort()
    clearTimeout(this.timer)
    const connection = this.live
    this.live = undefined
    await this.restarting?.catch(() => undefined)
    await connection?.close()
  }

  private async use<T>(run: (connection: McpConnection) => Promise<T>): Promise<T> {
    this.begin()
    try {
      return await run(this.live ?? (await this.restart()))
    } finally {
      this.end()
    }
  }

  private begin(): void {
    this.busy++
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private end(): void {
    this.busy--
    this.armIdleTimer()
  }

  private armIdleTimer(): void {
    if (this.busy > 0 || !this.live || this.lifetime.signal.aborted) return
    this.timer = setTimeout(() => void this.stopIdle(), this.options.idleMs)
    this.timer.unref?.()
  }

  private async stopIdle(): Promise<void> {
    this.timer = undefined
    const connection = this.live
    if (this.busy > 0 || !connection || this.lifetime.signal.aborted) return
    this.live = undefined
    try {
      await connection.close()
      this.options.onStateChange('idle')
    } catch (error) {
      this.options.onStateChange('error', error)
    }
  }

  private restart(): Promise<McpConnection> {
    if (this.lifetime.signal.aborted) return Promise.reject(new Error('MCP connection is closed'))
    this.restarting ??= (async () => {
      this.options.onStateChange('connecting')
      try {
        const connection = await this.options.reconnect(this.lifetime.signal)
        if (this.lifetime.signal.aborted) {
          await connection.close()
          throw new Error('MCP connection is closed')
        }
        this.live = this.last = connection
        this.options.onStateChange('connected')
        return connection
      } catch (error) {
        if (!this.lifetime.signal.aborted) this.options.onStateChange('error', error)
        throw error
      }
    })().finally(() => {
      this.restarting = undefined
    })
    return this.restarting
  }
}
