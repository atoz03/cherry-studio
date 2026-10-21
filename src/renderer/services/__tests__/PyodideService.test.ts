import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'

import { pyodideService } from '../PyodideService'

const workers = vi.hoisted(() => ({ created: 0, terminated: 0, silentScript: 'never answers' }))

vi.mock('../../workers/pyodide.worker?worker', () => ({
  default: class MockPyodideWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    private listeners = new Set<(event: MessageEvent) => void>()

    constructor() {
      workers.created++
      this.emit({ type: 'initialized' })
    }

    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.add(listener)
    }

    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener)
    }

    postMessage({ id, python }: { id: string; python: string }) {
      if (python === workers.silentScript) return
      this.emit({ id, output: { result: null, text: `ran ${python}`, error: null } })
    }

    terminate() {
      workers.terminated++
    }

    private emit(data: unknown) {
      void Promise.resolve().then(() => {
        const event = { data } as MessageEvent
        this.onmessage?.(event)
        this.listeners.forEach((listener) => listener(event))
      })
    }
  }
}))

const FIVE_MINUTES = 5 * 60_000

describe('PyodideService idle stop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    workers.created = 0
    workers.terminated = 0
  })

  afterEach(() => {
    pyodideService.terminate()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  // Without the stop, the Python runtime stays loaded for the rest of the session.
  it('stops an idle runtime and starts a fresh one for the next run', async () => {
    await preferenceService.set('app.memory.release_idle_runtimes', true)

    await expect(pyodideService.runScript('first')).resolves.toEqual({ text: 'ran first', image: undefined })
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES)
    expect(workers.terminated).toBe(1)

    await expect(pyodideService.runScript('second')).resolves.toMatchObject({ text: 'ran second' })
    expect(workers.created).toBe(2)
  })

  it('keeps the runtime when the user turned the switch off', async () => {
    await preferenceService.set('app.memory.release_idle_runtimes', false)

    await pyodideService.runScript('first')
    await vi.advanceTimersByTimeAsync(2 * FIVE_MINUTES)

    expect(workers.terminated).toBe(0)
  })

  // The idle clock of an earlier run must not kill a script that is still running.
  it('never stops a runtime while a script is running', async () => {
    await preferenceService.set('app.memory.release_idle_runtimes', true)
    await pyodideService.runScript('first')

    void pyodideService.runScript(workers.silentScript, {}, 4 * FIVE_MINUTES)
    await vi.advanceTimersByTimeAsync(2 * FIVE_MINUTES)

    expect(workers.terminated).toBe(0)
  })
})
