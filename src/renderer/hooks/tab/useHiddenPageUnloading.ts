import { useEffect, useRef } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { hiddenPageUnloader } from '@renderer/services/HiddenPageUnloader'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const BROWSER_ROUTE = '/app/browser'

function isBrowserTab(tab: Tab): boolean {
  return tab.type === 'route' && (tab.url === BROWSER_ROUTE || tab.url.startsWith(`${BROWSER_ROUTE}?`))
}

/**
 * Drives this window's hidden-page clock: applies `app.memory.unload_hidden_pages_minutes` and
 * hibernates built-in browser tabs that stay unpinned in the background past it. The tab keeps
 * its URL, so waking it reloads the same page.
 */
export function useHiddenPageUnloading(
  tabs: readonly Tab[],
  activeTabId: string,
  hibernate: (tabId: string) => void
): void {
  const [minutes] = usePreference('app.memory.unload_hidden_pages_minutes')
  useEffect(() => hiddenPageUnloader.setTimeoutMinutes(minutes), [minutes])

  const tracked = useRef(new Set<string>())
  useEffect(() => {
    const hidden = new Map(
      tabs
        .filter((tab) => tab.id !== activeTabId && !tab.isDormant && !tab.isPinned && isBrowserTab(tab))
        .map((tab) => [`browser-tab:${tab.id}`, tab.id])
    )
    for (const key of tracked.current) {
      if (hidden.has(key)) continue
      hiddenPageUnloader.show(key)
      tracked.current.delete(key)
    }
    for (const [key, tabId] of hidden) {
      hiddenPageUnloader.hide(key, () => hibernate(tabId))
      tracked.current.add(key)
    }
  }, [tabs, activeTabId, hibernate])

  useEffect(() => {
    const keys = tracked.current
    return () => {
      for (const key of keys) hiddenPageUnloader.show(key)
      keys.clear()
    }
  }, [])
}
