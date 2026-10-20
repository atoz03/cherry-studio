import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService, ServiceContainer } from '@main/core/lifecycle'

const { forkFeatures, sentryModuleLoaded } = vi.hoisted(() => ({
  forkFeatures: { FORK_SENTRY_ENABLED: false },
  sentryModuleLoaded: vi.fn()
}))

vi.mock('@shared/utils/forkFeatures', () => forkFeatures)
vi.mock('../sentry', () => {
  sentryModuleLoaded()
  return { attachSentryLogTransport: () => () => {} }
})

import { SentryLogService } from '../SentryLogService'

beforeEach(() => {
  ServiceContainer.reset()
  BaseService.resetInstances()
})

afterEach(() => {
  forkFeatures.FORK_SENTRY_ENABLED = false
  vi.unstubAllEnvs()
})

describe('SentryLogService and FORK_SENTRY_ENABLED', () => {
  it('is excluded from the lifecycle without loading the Sentry module while the switch is off', () => {
    const container = ServiceContainer.getInstance()
    container.register(SentryLogService)

    expect(container.isExcluded('SentryLogService')).toBe(true)
    expect(container.getOptional('SentryLogService')).toBeUndefined()
    expect(sentryModuleLoaded).not.toHaveBeenCalled()
  })

  it('registers and attaches the log transport while the switch is on', async () => {
    forkFeatures.FORK_SENTRY_ENABLED = true
    vi.stubEnv('DEV', false)
    const container = ServiceContainer.getInstance()
    container.register(SentryLogService)
    expect(container.isExcluded('SentryLogService')).toBe(false)

    const service = new SentryLogService()
    await service._doInit()
    expect(sentryModuleLoaded).toHaveBeenCalledTimes(1)
    await service._doDestroy()
  })
})
