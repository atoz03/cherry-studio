import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

// Scheduling only: the update cycle itself is covered by ProviderRegistryUpdaterService.test.ts.
vi.mock('@main/data/services/ProviderRegistryService', () => ({ providerRegistryService: {} }))
vi.mock('@main/data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))
vi.mock('@main/data/services/utils/registryDataPaths', () => ({ readActiveOverrideManifest: vi.fn() }))
vi.mock('@main/services/providerRegistrySnapshot', () => ({ writeProviderRegistrySnapshot: vi.fn() }))

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'

import { BaseService } from '@main/core/lifecycle'

import { ProviderRegistryUpdaterService } from '../ProviderRegistryUpdaterService'

const INITIAL_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const AUTO_UPDATE_KEY = 'app.provider_registry.auto_update.enabled'

const setPackaged = (value: boolean) => {
  ;(app as { isPackaged: boolean }).isPackaged = value
}

async function startService(): Promise<ProviderRegistryUpdaterService> {
  const service = new ProviderRegistryUpdaterService()
  await service._doInit()
  return service
}

describe('ProviderRegistryUpdaterService scheduling', () => {
  let check: MockInstance<ProviderRegistryUpdaterService['check']>

  beforeEach(() => {
    vi.useFakeTimers()
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue(AUTO_UPDATE_KEY, true)
    setPackaged(true)
    check = vi.spyOn(ProviderRegistryUpdaterService.prototype, 'check').mockResolvedValue()
  })

  afterEach(() => {
    check.mockRestore()
    setPackaged(false)
    vi.useRealTimers()
  })

  it('checks shortly after startup and then every 6 hours while enabled', async () => {
    await startService()

    vi.advanceTimersByTime(INITIAL_CHECK_DELAY_MS)
    expect(check).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(CHECK_INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('arms no timer while disabled', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(AUTO_UPDATE_KEY, false)
    await startService()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(2 * CHECK_INTERVAL_MS)
    expect(check).not.toHaveBeenCalled()
  })

  it('stops and resumes when the preference changes at runtime', async () => {
    await startService()

    MockMainPreferenceServiceUtils.setPreferenceValue(AUTO_UPDATE_KEY, false)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(2 * CHECK_INTERVAL_MS)
    expect(check).not.toHaveBeenCalled()

    MockMainPreferenceServiceUtils.setPreferenceValue(AUTO_UPDATE_KEY, true)
    vi.advanceTimersByTime(INITIAL_CHECK_DELAY_MS)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('clears its timers and stops listening when the service stops', async () => {
    const service = await startService()

    await service._doStop()
    MockMainPreferenceServiceUtils.setPreferenceValue(AUTO_UPDATE_KEY, false)
    MockMainPreferenceServiceUtils.setPreferenceValue(AUTO_UPDATE_KEY, true)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('never schedules downloads in development builds', async () => {
    setPackaged(false)
    await startService()

    expect(vi.getTimerCount()).toBe(0)
  })
})
