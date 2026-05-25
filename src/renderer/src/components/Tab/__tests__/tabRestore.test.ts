import type { Tab } from '@renderer/store/tabs'
import { describe, expect, it } from 'vitest'

import { ensureHomeTab, getStartupRedirectPath, sanitizeRestoredTabs } from '../tabRestore'

describe('tabRestore', () => {
  it('ensureHomeTab: 缺失 home 时补到最前面', () => {
    const tabs: Tab[] = [{ id: 'store', path: '/store' }]
    expect(ensureHomeTab(tabs)).toEqual([
      { id: 'home', path: '/' },
      { id: 'store', path: '/store' }
    ])
  })

  it('ensureHomeTab: 已存在 home 时保持引用不变', () => {
    const tabs: Tab[] = [
      { id: 'home', path: '/' },
      { id: 'store', path: '/store' }
    ]
    expect(ensureHomeTab(tabs)).toBe(tabs)
  })

  it('sanitizeRestoredTabs: 移除历史 agents 标签并保留 home', () => {
    const tabs: Tab[] = [
      { id: 'home', path: '/' },
      { id: 'agents', path: '/agents' },
      { id: 'store', path: '/store' }
    ]

    expect(sanitizeRestoredTabs(tabs)).toEqual([
      { id: 'home', path: '/' },
      { id: 'store', path: '/store' }
    ])
  })

  it('sanitizeRestoredTabs: 没有历史 agents 标签时保持引用不变', () => {
    const tabs: Tab[] = [
      { id: 'home', path: '/' },
      { id: 'store', path: '/store' }
    ]

    expect(sanitizeRestoredTabs(tabs)).toBe(tabs)
  })

  it('getStartupRedirectPath: 初始为 / 且激活标签不是 home 时返回目标 path', () => {
    const tabs: Tab[] = [
      { id: 'home', path: '/' },
      { id: 'store', path: '/store' }
    ]
    expect(getStartupRedirectPath({ currentPath: '/', tabs, activeTabId: 'store' })).toBe('/store')
  })

  it('getStartupRedirectPath: 非初始 / 时不做跳转', () => {
    const tabs: Tab[] = [
      { id: 'home', path: '/' },
      { id: 'store', path: '/store' }
    ]
    expect(getStartupRedirectPath({ currentPath: '/store', tabs, activeTabId: 'store' })).toBeNull()
  })

  it('getStartupRedirectPath: activeTabId 不存在时不做跳转', () => {
    const tabs: Tab[] = [{ id: 'home', path: '/' }]
    expect(getStartupRedirectPath({ currentPath: '/', tabs, activeTabId: 'store' })).toBeNull()
  })
})
