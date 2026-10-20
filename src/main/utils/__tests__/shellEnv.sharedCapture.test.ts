import type { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeShell extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const shells = vi.hoisted(() => [] as FakeShell[])

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: vi.fn(() => {
      const shell = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn()
      })
      shells.push(shell)
      return shell
    })
  }
})
vi.mock('@main/core/platform', () => ({ isWin: false, isMac: false }))

function finish(shell: FakeShell, output: string) {
  shell.stdout.emit('data', Buffer.from(output))
  shell.emit('close', 0)
}

describe('shellEnv shared login-shell capture', () => {
  beforeEach(() => {
    vi.resetModules()
    shells.length = 0
  })

  it('lets a cancellable lookup wait on the capture already running instead of starting a second shell', async () => {
    const { getRawShellEnv } = await import('../shellEnv')

    const shared = getRawShellEnv()
    const cancellable = getRawShellEnv(new AbortController().signal)
    expect(shells).toHaveLength(1)

    finish(shells[0], 'PATH=/login/bin\n')

    await expect(shared).resolves.toEqual({ PATH: '/login/bin' })
    await expect(cancellable).resolves.toEqual({ PATH: '/login/bin' })
    await expect(getRawShellEnv(new AbortController().signal)).resolves.toEqual({ PATH: '/login/bin' })
    expect(shells).toHaveLength(1)
  })

  it('ends only the aborted caller wait, leaving the shared shell running for everyone else', async () => {
    const { getRawShellEnv } = await import('../shellEnv')
    const controller = new AbortController()

    const shared = getRawShellEnv()
    const cancellable = getRawShellEnv(controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(cancellable).rejects.toThrow('cancelled')
    expect(shells[0].kill).not.toHaveBeenCalled()

    finish(shells[0], 'PATH=/login/bin\n')
    await expect(shared).resolves.toEqual({ PATH: '/login/bin' })
  })
})
