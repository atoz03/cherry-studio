import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

import { useIsPrivacyUpdateRequired } from '../useIsPrivacyUpdateRequired'

// Upstream behaviour (switch on); the fork's switched-off path is covered by the *.fork.test files.
vi.mock('@shared/utils/forkFeatures', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  FORK_DATA_COLLECTION_ENABLED: true
}))

describe('useIsPrivacyUpdateRequired', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('requires an update only while data collection is on and the acknowledged version is stale', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.privacy.data_collection.enabled': true,
      'app.privacy.policy_version': 'previous'
    })
    expect(renderHook(() => useIsPrivacyUpdateRequired()).result.current).toBe(true)

    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
    expect(renderHook(() => useIsPrivacyUpdateRequired()).result.current).toBe(false)

    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.privacy.data_collection.enabled': false,
      'app.privacy.policy_version': 'previous'
    })
    expect(renderHook(() => useIsPrivacyUpdateRequired()).result.current).toBe(false)
  })
})
