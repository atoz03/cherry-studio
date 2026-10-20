import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  mockUseMultiplePreferences,
  mockUsePreference,
  MockUsePreferenceUtils
} from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'

const responsiveStyles = readFileSync(join(process.cwd(), 'src/renderer/assets/styles/responsive.css'), 'utf8')

const toastErrorMock = vi.fn()
const modelSettingsPropsMock = vi.fn()
const dataApiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn()
}))
const i18nMock = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  language: 'en-US',
  resolvedLanguage: 'en-US'
}))
const enabledProvidersMock: Array<{ id: string; isEnabled: boolean }> = []
const enabledModelsMock: Array<{ id: string; providerId: string; isEnabled: boolean; capabilities: string[] }> = []
const selectedModelsMock: {
  defaultModel?: { id: string; providerId: string; capabilities: string[] }
  quickModel?: { id: string; providerId: string; capabilities: string[] }
  translateModel?: { id: string; providerId: string; capabilities: string[] }
} = {}
const defaultUsePreferenceImplementation = mockUsePreference.getMockImplementation()
const defaultUseMultiplePreferencesImplementation = mockUseMultiplePreferences.getMockImplementation()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: dataApiMocks
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: i18nMock
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: enabledProvidersMock, isLoading: false })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => selectedModelsMock,
  useModels: () => ({ models: enabledModelsMock, isLoading: false })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args)
  }
}))

vi.mock('@renderer/components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />
}))

vi.mock('@renderer/pages/settings/ProviderSettings', () => ({
  ProviderSettingsPage: () => <div data-testid="provider-settings" />
}))

vi.mock('@renderer/pages/settings/ModelSettings/ModelSettings', () => ({
  default: (props: {
    autoFillEmptyModels?: boolean
    modelFilter?: (model: { providerId: string; capabilities: string[] }) => boolean
    onDefaultModelSelected?: (model: { id: string; providerId: string }) => void | Promise<void>
    showPaintingModel?: boolean
  }) => {
    modelSettingsPropsMock(props)
    return <div data-testid="model-settings" />
  }
}))

import OnboardingPage from '../OnboardingPage'

async function openProviderSetup() {
  fireEvent.click(screen.getByRole('button', { name: /onboarding\.provider_setup\.title/ }))
  await screen.findByTestId('provider-settings')
}

async function openModelSelection() {
  await openProviderSetup()
  fireEvent.click(screen.getByRole('button', { name: 'onboarding.provider_setup.next' }))
  await screen.findByTestId('model-settings')
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (defaultUsePreferenceImplementation) {
      mockUsePreference.mockImplementation(defaultUsePreferenceImplementation)
    }
    if (defaultUseMultiplePreferencesImplementation) {
      mockUseMultiplePreferences.mockImplementation(defaultUseMultiplePreferencesImplementation)
    }
    MockUsePreferenceUtils.resetMocks()
    i18nMock.changeLanguage.mockResolvedValue(undefined)
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') return { items: [], total: 0 }
      if (path === '/agents') return { items: [], total: 0 }
      throw new Error(`Unexpected path: ${path}`)
    })
    dataApiMocks.patch.mockResolvedValue(undefined)
    enabledProvidersMock.splice(0, enabledProvidersMock.length, { id: 'openai', isEnabled: true })
    enabledModelsMock.splice(0, enabledModelsMock.length, {
      id: 'openai::gpt-4o-mini',
      providerId: 'openai',
      isEnabled: true,
      capabilities: []
    })
    selectedModelsMock.defaultModel = { id: 'default-model', providerId: 'openai', capabilities: [] }
    selectedModelsMock.quickModel = { id: 'quick-model', providerId: 'openai', capabilities: [] }
    selectedModelsMock.translateModel = { id: 'translate-model', providerId: 'openai', capabilities: [] }
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')
  })

  it('shows provider setup from the welcome step', async () => {
    render(<OnboardingPage />)

    await openProviderSetup()

    expect(screen.getByTestId('provider-settings')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'onboarding.provider_setup.title' })).toBeInTheDocument()
  })

  it('moves from provider setup to model selection and completes the flow', async () => {
    render(<OnboardingPage />)

    await openModelSelection()

    expect(screen.getByRole('heading', { name: 'onboarding.select_model.title' })).toBeInTheDocument()
    expect(screen.getByTestId('model-settings')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.select_model\.start/ }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    )
  })

  it('waits for official resources to use the selected model before completing', async () => {
    let resolveAgentUpdate: (() => void) | undefined
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') return { items: [], total: 0 }
      if (path === '/agents') {
        return {
          items: [{ id: 'support-agent', model: null, configuration: { builtin_role: 'support' } }],
          total: 1
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    dataApiMocks.patch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAgentUpdate = resolve
        })
    )
    render(<OnboardingPage />)

    await openModelSelection()
    fireEvent.click(screen.getByRole('button', { name: /onboarding\.select_model\.start/ }))

    await waitFor(() => expect(dataApiMocks.patch).toHaveBeenCalledTimes(1))
    expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('pending')

    resolveAgentUpdate?.()

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    )
  })

  it('configures official resources beyond the first page before completing', async () => {
    let resolveSupportUpdate: (() => void) | undefined
    dataApiMocks.get.mockImplementation(async (path: string, options?: { query?: { page?: number } }) => {
      if (path === '/assistants') return { items: [], total: 0 }
      if (path === '/agents' && options?.query?.page === 1) {
        return {
          items: Array.from({ length: 500 }, (_, index) => ({
            id: `ordinary-agent-${index}`,
            model: null,
            configuration: {}
          })),
          total: 501
        }
      }
      if (path === '/agents' && options?.query?.page === 2) {
        return {
          items: [{ id: 'support-agent', model: null, configuration: { builtin_role: 'support' } }],
          total: 501
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    dataApiMocks.patch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSupportUpdate = resolve
        })
    )
    render(<OnboardingPage />)

    await openModelSelection()
    fireEvent.click(screen.getByRole('button', { name: /onboarding\.select_model\.start/ }))

    await waitFor(() =>
      expect(dataApiMocks.patch).toHaveBeenCalledWith('/agents/support-agent', {
        body: { model: 'default-model' }
      })
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('pending')

    resolveSupportUpdate?.()

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    )
  })

  it('keeps onboarding pending when an official resource update fails and retries it', async () => {
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') return { items: [], total: 0 }
      if (path === '/agents') {
        return {
          items: [{ id: 'assistant-agent', model: null, configuration: { builtin_role: 'assistant' } }],
          total: 1
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    dataApiMocks.patch.mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce(undefined)
    render(<OnboardingPage />)

    await openModelSelection()
    const startButton = screen.getByRole('button', { name: /onboarding\.select_model\.start/ })
    fireEvent.click(startButton)

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('onboarding.toast.complete_failed'))
    expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('pending')
    expect(startButton).toBeEnabled()

    fireEvent.click(startButton)

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    )
    expect(dataApiMocks.patch).toHaveBeenCalledTimes(2)
  })

  it('does not allow CherryAI to satisfy the provider setup requirements', async () => {
    enabledProvidersMock.splice(0, enabledProvidersMock.length, { id: 'cherryai', isEnabled: true })
    enabledModelsMock.splice(0, enabledModelsMock.length, {
      id: 'cherryai::qwen',
      providerId: 'cherryai',
      isEnabled: true,
      capabilities: []
    })
    render(<OnboardingPage />)

    await openProviderSetup()

    const nextButton = screen.getByRole('button', { name: 'onboarding.provider_setup.next' })
    expect(nextButton).toHaveAttribute('aria-disabled', 'true')
    nextButton.focus()
    expect(nextButton).toHaveFocus()
    fireEvent.click(nextButton)
    expect(screen.getByRole('heading', { name: 'onboarding.provider_setup.title' })).toBeInTheDocument()
    expect(nextButton.parentElement).toHaveAttribute('data-title', 'onboarding.provider_setup.missing_provider')
  })

  it('explains when an enabled provider has no enabled model', async () => {
    enabledModelsMock.splice(0)
    render(<OnboardingPage />)

    await openProviderSetup()

    const nextButton = screen.getByRole('button', { name: 'onboarding.provider_setup.next' })
    expect(nextButton).toHaveAttribute('aria-disabled', 'true')
    expect(nextButton.parentElement).toHaveAttribute('data-title', 'onboarding.provider_setup.missing_model')
  })

  it('does not allow the seeded local embedding model to satisfy provider setup', async () => {
    enabledProvidersMock.splice(0, enabledProvidersMock.length, { id: 'local-embedding', isEnabled: true })
    enabledModelsMock.splice(0, enabledModelsMock.length, {
      id: 'local-embedding::qwen3-embedding-0.6b',
      providerId: 'local-embedding',
      isEnabled: true,
      capabilities: ['embedding']
    })
    render(<OnboardingPage />)

    await openProviderSetup()

    const nextButton = screen.getByRole('button', { name: 'onboarding.provider_setup.next' })
    expect(nextButton).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(nextButton)
    expect(screen.getByRole('heading', { name: 'onboarding.provider_setup.title' })).toBeInTheDocument()
    expect(nextButton.parentElement).toHaveAttribute('data-title', 'onboarding.provider_setup.missing_model')
  })

  it('keeps the start action disabled until all three models are selected', async () => {
    selectedModelsMock.translateModel = undefined
    render(<OnboardingPage />)

    await openModelSelection()

    expect(screen.getByRole('button', { name: /onboarding\.select_model\.start/ })).toBeDisabled()
  })

  it('does not complete with a persisted model whose provider is unavailable', async () => {
    selectedModelsMock.translateModel = { id: 'legacy::model', providerId: 'legacy', capabilities: [] }
    render(<OnboardingPage />)

    await openModelSelection()

    expect(screen.getByRole('button', { name: /onboarding\.select_model\.start/ })).toBeDisabled()
  })

  it('excludes CherryAI models, hides painting, and rejects built-in selections', async () => {
    selectedModelsMock.defaultModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID, capabilities: [] }
    selectedModelsMock.quickModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID, capabilities: [] }
    selectedModelsMock.translateModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID, capabilities: [] }
    render(<OnboardingPage />)

    await openModelSelection()

    const modelSettingsProps = modelSettingsPropsMock.mock.lastCall?.[0]
    expect(modelSettingsProps?.autoFillEmptyModels).toBe(true)
    expect(modelSettingsProps?.onDefaultModelSelected).toBeTypeOf('function')
    expect(modelSettingsProps?.showPaintingModel).toBe(false)
    expect(modelSettingsProps?.modelFilter?.({ providerId: CHERRYAI_PROVIDER_ID, capabilities: [] })).toBe(false)
    expect(modelSettingsProps?.modelFilter?.({ providerId: 'openai', capabilities: [] })).toBe(true)
    expect(screen.getByRole('button', { name: /onboarding\.select_model\.start/ })).toBeDisabled()
  })

  it.each([
    ['an unconfigured seeded agent', null],
    ['a legacy CherryAI-seeded agent', CHERRYAI_DEFAULT_UNIQUE_MODEL_ID]
  ])('configures %s after the user selects a default model', async (_description, seededAgentModel) => {
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') {
        return {
          items: [{ id: 'assistant-1', modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID }],
          total: 1
        }
      }
      if (path === '/agents') {
        return {
          items: [
            { id: 'assistant-agent', model: seededAgentModel, configuration: { builtin_role: 'assistant' } },
            { id: 'support-agent', model: seededAgentModel, configuration: { builtin_role: 'support' } }
          ],
          total: 2
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    dataApiMocks.patch.mockResolvedValue(undefined)
    render(<OnboardingPage />)

    await openModelSelection()

    const onDefaultModelSelected = modelSettingsPropsMock.mock.lastCall?.[0]?.onDefaultModelSelected
    await act(async () => {
      await onDefaultModelSelected?.({ id: 'openai::gpt-4o', providerId: 'openai' })
    })

    expect(dataApiMocks.get).toHaveBeenCalledWith('/assistants', { query: { limit: 2 } })
    expect(dataApiMocks.get).toHaveBeenCalledWith('/agents', { query: { limit: 500, page: 1 } })
    expect(dataApiMocks.patch).toHaveBeenCalledWith('/assistants/assistant-1', {
      body: { modelId: 'openai::gpt-4o' }
    })
    expect(dataApiMocks.patch).toHaveBeenCalledWith('/agents/assistant-agent', {
      body: { model: 'openai::gpt-4o' }
    })
    expect(dataApiMocks.patch).toHaveBeenCalledWith('/agents/support-agent', {
      body: { model: 'openai::gpt-4o' }
    })
  })

  it('preserves assistant and agent models unless both replacement conditions match', async () => {
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') {
        return {
          items: [
            { id: 'assistant-1', modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID },
            { id: 'assistant-2', modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID }
          ],
          total: 2
        }
      }
      if (path === '/agents') {
        return {
          items: [
            { id: 'ordinary-agent', model: null, configuration: {} },
            { id: 'assistant-agent', model: 'anthropic::custom', configuration: { builtin_role: 'assistant' } },
            { id: 'support-agent', model: 'openai::custom', configuration: { builtin_role: 'support' } }
          ],
          total: 3
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    render(<OnboardingPage />)

    await openModelSelection()

    const onDefaultModelSelected = modelSettingsPropsMock.mock.lastCall?.[0]?.onDefaultModelSelected
    await act(async () => {
      await onDefaultModelSelected?.({ id: 'openai::gpt-4o', providerId: 'openai' })
    })

    expect(dataApiMocks.patch).not.toHaveBeenCalled()
  })

  it('records a skipped status when the user skips onboarding', async () => {
    render(<OnboardingPage />)

    const skipButton = screen.getByRole('button', { name: 'onboarding.skip' })
    expect(skipButton).toHaveClass('nodrag')

    fireEvent.click(skipButton)

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('skipped')
    )
  })

  it('shows an error when completing onboarding fails', async () => {
    const updatePreferences = vi.fn().mockRejectedValueOnce(new Error('write failed'))
    mockUseMultiplePreferences.mockReturnValueOnce([{ providerSetupStatus: 'pending' }, updatePreferences])
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('onboarding.toast.complete_failed'))
    expect(updatePreferences).toHaveBeenCalledWith({ providerSetupStatus: 'skipped' })
    expect(screen.getByRole('button', { name: 'onboarding.skip' })).toBeEnabled()
  })

  it('renders window controls beside the skip action for frameless Windows', () => {
    const { container } = render(<OnboardingPage />)

    expect(screen.getByRole('button', { name: 'onboarding.skip' })).toBeInTheDocument()
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
    expect(container.querySelector('.drag')).toHaveClass('h-[var(--app-top-chrome-height)]')
    expect(responsiveStyles).toMatch(/--app-top-chrome-height:\s*44px/)
    expect(responsiveStyles).toMatch(/--navbar-height:\s*var\(--app-top-chrome-height\)/)
  })

  it('changes the interface language and saves the preference from the top chrome', async () => {
    render(<OnboardingPage />)

    const languageTrigger = screen.getByRole('button', { name: 'common.language' })

    expect(languageTrigger).toHaveClass('nodrag')

    fireEvent.click(screen.getByRole('button', { name: '中文' }))

    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('zh-CN')
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('app.language')).toBe('zh-CN'))
  })
})
