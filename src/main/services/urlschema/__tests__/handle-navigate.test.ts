import { describe, expect, it, vi } from 'vitest'

vi.mock('../../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => null),
    showMainWindow: vi.fn()
  }
}))

import { isAllowedRoute } from '../handle-navigate'

describe('isAllowedRoute', () => {
  it('allows only declared routes and their subpaths', () => {
    expect(isAllowedRoute('/')).toBe(true)
    expect(isAllowedRoute('/settings/provider')).toBe(true)
    expect(isAllowedRoute('/knowledge')).toBe(true)
    expect(isAllowedRoute('/knowledge/base')).toBe(true)
  })

  it('blocks removed or prefix-confusable routes', () => {
    expect(isAllowedRoute('/agents')).toBe(false)
    expect(isAllowedRoute('/settings-evil')).toBe(false)
    expect(isAllowedRoute('/knowledge-base')).toBe(false)
    expect(isAllowedRoute('/unknown')).toBe(false)
  })
})
