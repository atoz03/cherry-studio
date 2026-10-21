import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { AGENT_RUNTIME_CAPABILITIES } from '../agentRuntimeCapabilities'

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p',
    name: 'P',
    defaultChatEndpoint: 'anthropic-messages',
    endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } },
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [],
    contextWindow: 128_000,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

describe('AGENT_RUNTIME_CAPABILITIES', () => {
  it('keeps permission choices aligned with each runtime approval implementation', () => {
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('auto')
    // The user's pi CLI runs its tools without asking Cherry.
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).toEqual([])
  })

  describe('isModelCompatible', () => {
    const piProvider = makeProvider({ id: 'pi', authMethods: ['external-cli'] })

    it('pi accepts only models listed under the Pi provider', () => {
      expect(AGENT_RUNTIME_CAPABILITIES.pi.isModelCompatible(piProvider)).toBe(true)
      expect(AGENT_RUNTIME_CAPABILITIES.pi.isModelCompatible(makeProvider({}))).toBe(false)
    })

    it('claude accepts a normal model but not a Pi one', () => {
      expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].isModelCompatible(makeProvider({}), makeModel({}))).toBe(true)
      expect(
        AGENT_RUNTIME_CAPABILITIES['claude-code'].isModelCompatible(piProvider, makeModel({ providerId: 'pi' }))
      ).toBe(false)
    })
  })
})
