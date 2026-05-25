import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInstallBuiltinSkills, mockLoggerError, mockLoggerInfo, mockDeleteAgent } = vi.hoisted(() => ({
  mockInstallBuiltinSkills: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockDeleteAgent: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: mockLoggerInfo,
      error: mockLoggerError
    })
  }
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: mockInstallBuiltinSkills
}))

vi.mock('@main/services/agents/services/AgentService', () => ({
  agentService: {
    deleteAgent: mockDeleteAgent
  }
}))

describe('bootstrapBuiltinAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mockInstallBuiltinSkills.mockResolvedValue(undefined)
    mockDeleteAgent.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('installs built-in skills at startup', async () => {
    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockDeleteAgent).toHaveBeenCalledTimes(2)
    expect(mockDeleteAgent).toHaveBeenNthCalledWith(1, 'cherry-assistant-default')
    expect(mockDeleteAgent).toHaveBeenNthCalledWith(2, 'cherry-claw-default')
    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it('logs purge success when legacy presets are removed', async () => {
    mockDeleteAgent
      .mockResolvedValueOnce(true) // cherry-assistant-default
      .mockResolvedValueOnce(false) // cherry-claw-default

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockLoggerInfo).toHaveBeenCalledWith('Purged legacy preset agent', { id: 'cherry-assistant-default' })
  })

  it('logs and swallows install errors', async () => {
    const error = new Error('install failed')
    mockInstallBuiltinSkills.mockRejectedValueOnce(error)

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockDeleteAgent).toHaveBeenCalledTimes(2)
    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith('Failed to install built-in skills', error)
  })

  it('continues when purge fails for a legacy preset', async () => {
    const deleteError = new Error('delete failed')
    mockDeleteAgent
      .mockRejectedValueOnce(deleteError) // cherry-assistant-default
      .mockResolvedValueOnce(false) // cherry-claw-default

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to purge legacy preset agent', deleteError)
    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
  })
})
