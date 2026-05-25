import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInstallBuiltinSkills, mockLoggerError, mockLoggerInfo, mockPurgeLegacyPresetAgents } = vi.hoisted(() => ({
  mockInstallBuiltinSkills: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockPurgeLegacyPresetAgents: vi.fn()
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
    purgeLegacyPresetAgents: mockPurgeLegacyPresetAgents
  }
}))

describe('bootstrapBuiltinAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mockInstallBuiltinSkills.mockResolvedValue(undefined)
    mockPurgeLegacyPresetAgents.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('installs built-in skills at startup', async () => {
    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockPurgeLegacyPresetAgents).toHaveBeenCalledTimes(1)
    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it('logs purge success when legacy presets are removed', async () => {
    mockPurgeLegacyPresetAgents.mockResolvedValueOnce(['cherry-assistant-default', 'renamed_legacy_claw'])

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockLoggerInfo).toHaveBeenCalledWith('Purged legacy preset agent', { id: 'cherry-assistant-default' })
    expect(mockLoggerInfo).toHaveBeenCalledWith('Purged legacy preset agent', { id: 'renamed_legacy_claw' })
  })

  it('logs and swallows install errors', async () => {
    const error = new Error('install failed')
    mockInstallBuiltinSkills.mockRejectedValueOnce(error)

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockPurgeLegacyPresetAgents).toHaveBeenCalledTimes(1)
    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith('Failed to install built-in skills', error)
  })

  it('continues when purging legacy presets fails', async () => {
    const purgeError = new Error('purge failed')
    mockPurgeLegacyPresetAgents.mockRejectedValueOnce(purgeError)

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockLoggerError).toHaveBeenCalledWith('Failed to purge legacy preset agents', purgeError)
    expect(mockInstallBuiltinSkills).toHaveBeenCalledTimes(1)
  })
})
