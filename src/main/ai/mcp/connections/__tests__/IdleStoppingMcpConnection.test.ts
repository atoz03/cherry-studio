import type { CallToolResult } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IdleStoppingState } from '../IdleStoppingMcpConnection'
import { IdleStoppingMcpConnection } from '../IdleStoppingMcpConnection'
import type { McpCallToolOptions, McpConnection } from '../McpConnection'

const IDLE_MS = 10 * 60_000

function fakeServer(version: string) {
  const observationClose = vi.fn(async () => undefined)
  const connection = {
    era: 'legacy',
    serverVersion: version,
    serverCapabilities: { tools: {} },
    instructions: `instructions from ${version}`,
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async (): Promise<CallToolResult> => ({ content: [{ type: 'text', text: version }] })),
    forwardRequest: vi.fn(),
    listPrompts: vi.fn(async () => []),
    getPrompt: vi.fn(),
    listResources: vi.fn(async () => []),
    listResourceTemplates: vi.fn(async () => []),
    readResource: vi.fn(),
    observeResource: vi.fn(() => ({ close: observationClose })),
    health: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  } satisfies McpConnection
  return connection
}

function callOptions(): McpCallToolOptions {
  return { signal: new AbortController().signal, timeoutMs: 60_000 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('IdleStoppingMcpConnection', () => {
  let states: IdleStoppingState[]
  let onStateChange: ReturnType<typeof vi.fn<(state: IdleStoppingState, error?: unknown) => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    states = []
    onStateChange = vi.fn((state: IdleStoppingState) => {
      states.push(state)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function wrap(first: McpConnection, reconnect: (signal: AbortSignal) => Promise<McpConnection>) {
    return new IdleStoppingMcpConnection(first, { idleMs: IDLE_MS, reconnect, onStateChange })
  }

  it('stops the server process after the idle window with no request', async () => {
    const first = fakeServer('1.0.0')
    wrap(first, vi.fn())

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(first.close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['idle'])
  })

  it('counts the idle window from the last request', async () => {
    const first = fakeServer('1.0.0')
    const connection = wrap(first, vi.fn())

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1_000)
    await connection.callTool('tool', {}, callOptions())
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(first.close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(first.close).toHaveBeenCalledTimes(1)
  })

  it('never stops a server while a tool call is still running', async () => {
    const first = fakeServer('1.0.0')
    const result = deferred<CallToolResult>()
    first.callTool.mockReturnValueOnce(result.promise)
    const connection = wrap(first, vi.fn())

    const call = connection.callTool('slow_tool', {}, callOptions())
    // Other requests finishing meanwhile must not start the idle window under the running call.
    await connection.listTools()
    await vi.advanceTimersByTimeAsync(IDLE_MS * 3)
    expect(first.close).not.toHaveBeenCalled()

    result.resolve({ content: [] })
    await call
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(first.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(first.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the server running while a resource observation is open', async () => {
    const first = fakeServer('1.0.0')
    const connection = wrap(first, vi.fn())

    const observation = connection.observeResource('file:///watched', vi.fn())
    await vi.advanceTimersByTimeAsync(IDLE_MS * 3)
    expect(first.close).not.toHaveBeenCalled()

    await observation.close()
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(first.close).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh process for the next request after an idle stop', async () => {
    const first = fakeServer('1.0.0')
    const second = fakeServer('2.0.0')
    const reconnect = vi.fn(async () => second)
    const connection = wrap(first, reconnect)
    await vi.advanceTimersByTimeAsync(IDLE_MS)

    const [a, b] = await Promise.all([
      connection.callTool('tool', {}, callOptions()),
      connection.callTool('tool', {}, callOptions())
    ])

    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ content: [{ type: 'text', text: '2.0.0' }] })
    expect(b).toEqual({ content: [{ type: 'text', text: '2.0.0' }] })
    expect(first.callTool).not.toHaveBeenCalled()
    expect(connection.serverVersion).toBe('2.0.0')
    expect(states).toEqual(['idle', 'connecting', 'connected'])
  })

  it('restarts a stopped server on the health probe the runtime runs before reuse', async () => {
    const first = fakeServer('1.0.0')
    const second = fakeServer('2.0.0')
    const reconnect = vi.fn(async () => second)
    const connection = wrap(first, reconnect)
    await vi.advanceTimersByTimeAsync(IDLE_MS)

    await connection.health()

    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(second.health).toHaveBeenCalledTimes(1)
  })

  it('keeps the last server metadata readable while stopped', async () => {
    const first = fakeServer('1.0.0')
    const connection = wrap(first, vi.fn())
    await vi.advanceTimersByTimeAsync(IDLE_MS)

    expect(connection.serverVersion).toBe('1.0.0')
    expect(connection.instructions).toBe('instructions from 1.0.0')
    expect(connection.serverCapabilities).toEqual({ tools: {} })
  })

  it('reports a failed restart and tries again on the following request', async () => {
    const first = fakeServer('1.0.0')
    const second = fakeServer('2.0.0')
    const failure = new Error('spawn failed')
    const reconnect = vi.fn<(signal: AbortSignal) => Promise<McpConnection>>()
    reconnect.mockRejectedValueOnce(failure).mockResolvedValueOnce(second)
    const connection = wrap(first, reconnect)
    await vi.advanceTimersByTimeAsync(IDLE_MS)

    await expect(connection.listTools()).rejects.toBe(failure)
    expect(onStateChange).toHaveBeenLastCalledWith('error', failure)

    await expect(connection.listTools()).resolves.toEqual([])
    expect(reconnect).toHaveBeenCalledTimes(2)
  })

  it('closes a process that finishes starting after the connection was closed', async () => {
    const first = fakeServer('1.0.0')
    const second = fakeServer('2.0.0')
    const started = deferred<McpConnection>()
    const reconnect = vi.fn<(signal: AbortSignal) => Promise<McpConnection>>(() => started.promise)
    const connection = wrap(first, reconnect)
    await vi.advanceTimersByTimeAsync(IDLE_MS)

    const call = connection.callTool('tool', {}, callOptions())
    await vi.advanceTimersByTimeAsync(0)
    const closing = connection.close()
    expect(reconnect.mock.calls[0][0].aborted).toBe(true)

    started.resolve(second)
    await closing
    await expect(call).rejects.toThrow('MCP connection is closed')
    expect(second.close).toHaveBeenCalledTimes(1)
    expect(states).not.toContain('connected')
  })

  it('stops counting idle time once closed', async () => {
    const first = fakeServer('1.0.0')
    const connection = wrap(first, vi.fn())

    await connection.close()
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2)

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(states).toEqual([])
  })
})
