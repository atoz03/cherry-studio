import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInstallBuiltinSkills, mockLoggerError } = vi.hoisted(() => ({
  mockInstallBuiltinSkills: vi.fn(),
  mockLoggerError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mockLoggerError
    })
  }
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: mockInstallBuiltinSkills
}))

describe('bootstrapBuiltinAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mockInstallBuiltinSkills.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('installs built-in skills at startup', async () => {
    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it('logs and swallows install errors', async () => {
    const error = new Error('install failed')
    mockInstallBuiltinSkills.mockRejectedValueOnce(error)

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith('Failed to install built-in skills', error)
  })
})
