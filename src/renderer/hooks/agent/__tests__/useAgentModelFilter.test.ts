import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { useAgentModelFilter } from '../useAgentModelFilter'

function model(capabilities: Model['capabilities'] = []): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    contextWindow: 128_000,
    capabilities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

const providers = {
  openai: { id: 'openai', defaultChatEndpoint: 'openai-chat-completions', authType: 'api-key' }
} as const satisfies Record<string, Partial<Provider>>

const piProvider = { id: 'pi', name: 'Pi', authMethods: ['external-cli'] } as Provider

describe('useAgentModelFilter', () => {
  it('allows Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' })).toBe(true)
  })

  it('continues to reject non-chat model classes for regular agents', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(model())).toBe(true)
    expect(result.current(model([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
  })

  it('keeps Pi models out of Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'pi', id: 'pi::default' }, piProvider)).toBe(false)
  })

  describe('pi agents', () => {
    it('offers only the models listed under the Pi provider', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(result.current({ ...model(), providerId: 'pi', id: 'pi::default' }, piProvider)).toBe(true)
      expect(result.current({ ...model(), providerId: 'pi', id: 'pi::anthropic/claude-sonnet-4-5' }, piProvider)).toBe(
        true
      )
      expect(
        result.current({ ...model(), providerId: 'openai', id: 'openai::gpt-4o' }, providers.openai as Provider)
      ).toBe(false)
      expect(result.current({ ...model(), providerId: 'ghost', id: 'ghost::model' })).toBe(false)
    })
  })
})
