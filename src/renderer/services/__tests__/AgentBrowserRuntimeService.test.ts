import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'

import { AgentBrowserRuntimeService } from '../AgentBrowserRuntimeService'
import { HiddenPageUnloader } from '../HiddenPageUnloader'

const MINUTE = 60_000

describe('AgentBrowserRuntimeService hidden page unloading', () => {
  let service: AgentBrowserRuntimeService

  beforeEach(() => {
    vi.useFakeTimers()
    MockCacheUtils.resetMocks()
    const unloader = new HiddenPageUnloader()
    unloader.setTimeoutMinutes(1)
    service = new AgentBrowserRuntimeService('agent', unloader)
    service.declare('s1', 'tab-1')
    service.ensure('s1', 'https://start.example')
    service.update('s1', { url: 'https://visited.example' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('unloads a hidden page and reopens the page it was on', () => {
    vi.advanceTimersByTime(MINUTE)
    expect(service.get('s1')).toBeUndefined()

    service.ensure('s1', 'https://start.example')
    expect(service.get('s1')?.sourceUrl).toBe('https://visited.example')
  })

  it('keeps a page that is shown', () => {
    service.update('s1', { anchor: document.createElement('div') })

    vi.advanceTimersByTime(10 * MINUTE)
    expect(service.get('s1')).toBeDefined()
  })

  // An agent may drive the page while nobody looks at it; unloading would break its turn.
  it('keeps a hidden page while an agent turn is running in that session', () => {
    MockCacheUtils.setInitialState({
      shared: [[`topic.stream.statuses.${buildAgentSessionTopicId('s1')}`, { status: 'streaming' }]]
    })

    vi.advanceTimersByTime(10 * MINUTE)
    expect(service.get('s1')).toBeDefined()
  })
})
