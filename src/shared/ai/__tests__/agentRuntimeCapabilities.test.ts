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
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
    // pi implements `auto` itself in the approval extension, so it offers it.
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).toContain('auto')
    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].createDefaults.permissionMode).toBe('auto')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.createDefaults.permissionMode).toBe('auto')
  })

  describe('isModelCompatible', () => {
    it('pi accepts a normal pi-compatible model', () => {
      expect(AGENT_RUNTIME_CAPABILITIES.pi.isModelCompatible(makeProvider({}), makeModel({}))).toBe(true)
    })

    it('claude accepts a normal model', () => {
      expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].isModelCompatible(makeProvider({}), makeModel({}))).toBe(true)
    })
  })
})
