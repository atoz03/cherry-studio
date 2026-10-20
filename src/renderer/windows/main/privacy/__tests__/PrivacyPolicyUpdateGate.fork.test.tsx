import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useIsPrivacyUpdateRequired } from '@renderer/hooks/useIsPrivacyUpdateRequired'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('../PrivacyPolicyDialog', () => ({
  PrivacyPolicyDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="full-policy" /> : null)
}))

import { PrivacyPolicyUpdateGate } from '../PrivacyPolicyUpdateGate'

describe('privacy-policy update gate while nothing collects data', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    // The state that blocks the window upstream: collection on (the default) and no acknowledged policy.
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.privacy.data_collection.enabled': true,
      'app.privacy.policy_version': ''
    })
  })

  it('never requires a policy acknowledgement', () => {
    expect(renderHook(() => useIsPrivacyUpdateRequired()).result.current).toBe(false)
  })

  it('renders no blocking dialog and records nothing', () => {
    render(<PrivacyPolicyUpdateGate />)

    expect(screen.queryByRole('heading', { name: 'privacy_policy_update.title' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-policy')).not.toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(true)
  })
})
