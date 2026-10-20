import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dataApiGet: vi.fn(),
  dataApiPatch: vi.fn()
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@data/DataApiService', () => ({ dataApiService: { get: mocks.dataApiGet, patch: mocks.dataApiPatch } }))
vi.mock('@renderer/i18n/resolver', () => ({
  default: { changeLanguage: vi.fn(), language: 'en-US', resolvedLanguage: 'en-US' }
}))
vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ addApiKey: vi.fn(), updateProvider: vi.fn() }),
  useProviders: () => ({ providers: [{ id: 'openai', isEnabled: true }], isLoading: false })
}))
vi.mock('@renderer/hooks/useModel', () => {
  const model = (id: string) => ({ id, providerId: 'openai', capabilities: [] })
  return {
    useDefaultModel: () => ({
      defaultModel: model('default-model'),
      quickModel: model('quick-model'),
      translateModel: model('translate-model')
    }),
    useModels: () => ({
      models: [{ id: 'openai::gpt-4o-mini', providerId: 'openai', isEnabled: true, capabilities: [] }],
      isLoading: false
    })
  }
})
vi.mock('@renderer/services/oauth', () => ({ oauthWithCherryIn: vi.fn() }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/components/WindowControls', () => ({ WindowControls: () => null }))
vi.mock('@renderer/pages/settings/ProviderSettings', () => ({
  ProviderSettingsPage: () => <div data-testid="provider-settings" />,
  useProviderModelSync: () => ({ syncProviderModels: vi.fn(), isSyncingModels: false })
}))
vi.mock('@renderer/pages/settings/ModelSettings/ModelSettings', () => ({
  default: () => <div data-testid="model-settings" />
}))
vi.mock('../../privacy/PrivacyPolicyDialog', () => ({
  PrivacyPolicyDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="privacy-policy-dialog" /> : null)
}))

import OnboardingPage from '../OnboardingPage'

const privacyPreferences = () => ({
  dataCollectionEnabled: MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled'),
  policyVersion: MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')
})

describe('OnboardingPage while nothing collects data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    mocks.dataApiGet.mockResolvedValue({ items: [], total: 0 })
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
  })

  it('shows no consent checkbox or privacy-policy link', () => {
    render(<OnboardingPage />)

    expect(screen.getByRole('heading', { name: 'onboarding.welcome.title' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'onboarding.privacy.policy' })).not.toBeInTheDocument()
  })

  it('completes provider and model setup without recording a privacy choice', async () => {
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    await screen.findByTestId('provider-settings')
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.provider_setup.next' }))
    await screen.findByTestId('model-settings')
    fireEvent.click(screen.getByRole('button', { name: /onboarding\.select_model\.start/ }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    )
    expect(privacyPreferences()).toEqual({ dataCollectionEnabled: true, policyVersion: '' })
  })

  it('skips onboarding without recording a privacy choice', async () => {
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('skipped')
    )
    expect(privacyPreferences()).toEqual({ dataCollectionEnabled: true, policyVersion: '' })
  })
})
