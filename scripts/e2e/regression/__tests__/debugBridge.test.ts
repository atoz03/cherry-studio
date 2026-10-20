import type * as ChildProcess from 'node:child_process'

import { afterEach, vi } from 'vitest'

import { prepareWindowsCdpConnection } from '../debugBridge'
import type { AppRecord } from '../lifecycle'

const { evaluateCdpExpressionMock, execFileSyncMock } = vi.hoisted(() => ({
  evaluateCdpExpressionMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: execFileSyncMock
}))
vi.mock('../cdpClient', () => ({ evaluateCdpExpression: evaluateCdpExpressionMock }))

afterEach(() => {
  evaluateCdpExpressionMock.mockReset()
  execFileSyncMock.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function ownedApp(platform: 'macos' | 'windows', listenerPid = 42_001): AppRecord {
  const targetRoot = platform === 'macos' ? '/tmp/target-app' : 'D:\\target-app'
  const record: AppRecord = {
    schemaVersion: 1,
    ownership: 'regression-driver',
    policy: 'ephemeral',
    mode: 'branch',
    platform,
    profile: 'authenticated',
    runKey: 'test-run',
    targetRoot,
    command: 'pnpm',
    args: ['debug'],
    cwd: targetRoot,
    runnerPid: 42_000,
    electronPid: 42_001,
    cdpPort: 9222,
    targetUrl: 'http://127.0.0.1:9222',
    logPath: `${targetRoot}/electron.log`,
    startedAt: '2026-08-22T00:00:00.000Z',
    restartCount: 0
  }
  vi.spyOn(process, 'kill').mockReturnValue(true)
  execFileSyncMock.mockImplementation((file: string, args: string[]) => {
    const script = String(args.at(-1))
    if (file === 'lsof') return String(args.includes('-iTCP:9222') ? record.electronPid : listenerPid)
    if (script.includes('Get-NetTCPConnection'))
      return String(script.includes('9222') ? record.electronPid : listenerPid)
    if (file === 'ps' || script.includes('CommandLine'))
      return `${targetRoot}/node_modules/electron/Electron ${targetRoot}`
    throw new Error(`Unexpected command: ${file}`)
  })
  return record
}

describe('owned application debug bridge', () => {
  it('rejects a main-process inspector owned by another process', async () => {
    const record = ownedApp('windows', 99_999)
    await expect(prepareWindowsCdpConnection(record)).rejects.toThrow('does not own the main-process inspector')
    expect(evaluateCdpExpressionMock).not.toHaveBeenCalled()
  })
})
