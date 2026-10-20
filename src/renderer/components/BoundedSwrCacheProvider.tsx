import { type ReactNode, useState } from 'react'
import { SWRConfig, type SWRConfiguration } from 'swr'

import {
  BoundedSwrCache,
  createSwrCacheRetentionMiddleware,
  SWR_CACHE_MAX_ENTRIES
} from '@renderer/data/boundedSwrCache'

/**
 * Window-root SWR cache with a key-count bound, so cached query results stop growing with
 * every topic or page visited. Must wrap every SWR consumer of the window: hooks outside it
 * would read SWR's default cache and miss its mutations.
 */
export function BoundedSwrCacheProvider({ children }: { children: ReactNode }) {
  const [config] = useState<SWRConfiguration>(() => {
    const cache = new BoundedSwrCache(SWR_CACHE_MAX_ENTRIES)
    return { provider: () => cache, use: [createSwrCacheRetentionMiddleware(cache)] }
  })

  return <SWRConfig value={config}>{children}</SWRConfig>
}
