import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

const { analyticsClientLoaded, prefHandlers, preferenceValues } = vi.hoisted(() => ({
  analyticsClientLoaded: vi.fn(),
  prefHandlers: {} as Record<string, (value: unknown) => void>,
  preferenceValues: {} as Record<string, unknown>
}))

vi.mock('@cherrystudio/analytics-client', () => {
  analyticsClientLoaded()
  return { AnalyticsClient: vi.fn() }
})

vi.mock('@main/utils/systemInfo', () => ({
  getClientId: vi.fn(() => 'test-client-id'),
  generateUserAgent: vi.fn(() => 'test-user-agent')
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: {
      subscribeChange: vi.fn((key: string, callback: (value: unknown) => void) => {
        prefHandlers[key] = callback
        return () => {}
      }),
      get: vi.fn((key: string) => preferenceValues[key])
    }
  })
})

import { AnalyticsService } from '../AnalyticsService'

const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  BaseService.resetInstances()
  preferenceValues['app.privacy.data_collection.enabled'] = true
  preferenceValues['app.privacy.policy_version'] = LATEST_PRIVACY_POLICY_VERSION
})

describe('AnalyticsService with FORK_ANALYTICS_ENABLED off', () => {
  it('never activates or loads the analytics client, even with consent granted', async () => {
    const service = new AnalyticsService()
    await service._doInit()
    prefHandlers['app.privacy.policy_version']?.(LATEST_PRIVACY_POLICY_VERSION)
    prefHandlers['app.privacy.data_collection.enabled']?.(true)
    await flush()

    expect(service.isActivated).toBe(false)
    expect(analyticsClientLoaded).not.toHaveBeenCalled()
  })

  it('treats token-usage and update tracking from its callers as no-ops', async () => {
    const service = new AnalyticsService()
    await service._doInit()

    expect(() =>
      service.trackTokenUsage({ provider: 'openai', model: 'gpt', input_tokens: 10, output_tokens: 20 })
    ).not.toThrow()
    await expect(service.trackAppUpdate()).resolves.toBeUndefined()
    expect(analyticsClientLoaded).not.toHaveBeenCalled()
  })
})
