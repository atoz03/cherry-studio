import { useLayoutEffect } from 'react'
import { type Cache, type Key, type Middleware, unstable_serialize } from 'swr'
import { type SWRInfiniteKeyLoader, unstable_serialize as serializeInfiniteKey } from 'swr/infinite'

/** Default number of SWR cache keys a window keeps; keys read by mounted hooks are never evicted. */
export const SWR_CACHE_MAX_ENTRIES = 200

type CacheState = NonNullable<ReturnType<Cache['get']>>

/**
 * SWR cache provider bounded by key count. When it holds more than `maxEntries` keys it
 * drops the least recently read or written ones, skipping keys a mounted hook retains, so
 * a later mount refetches them like a first visit.
 */
export class BoundedSwrCache implements Cache {
  private readonly entries = new Map<string, CacheState>()
  private readonly retainCounts = new Map<string, number>()

  constructor(private readonly maxEntries: number) {}

  keys(): IterableIterator<string> {
    // Snapshot: SWR reads entries while iterating keys, and every read reorders the map.
    return [...this.entries.keys()].values()
  }

  get(key: string): CacheState | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }

  set(key: string, value: CacheState): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    this.evict()
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  /** Keeps `key` from being evicted until the returned release function runs. */
  retain(key: string): () => void {
    this.retainCounts.set(key, (this.retainCounts.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.retainCounts.get(key) ?? 1) - 1
      if (remaining > 0) this.retainCounts.set(key, remaining)
      else this.retainCounts.delete(key)
      this.evict()
    }
  }

  private evict(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) return
      if (!this.retainCounts.has(key)) this.entries.delete(key)
    }
  }
}

function serializeInfiniteLoader(key: Key): string {
  if (typeof key !== 'function') return ''
  try {
    return serializeInfiniteKey(key as SWRInfiniteKeyLoader)
  } catch {
    return ''
  }
}

/**
 * SWR middleware that retains each mounted hook's key in `cache`. A function key may be a
 * `useSWRInfinite` page loader, so its aggregate `$inf$` key is retained as well.
 */
export function createSwrCacheRetentionMiddleware(cache: BoundedSwrCache): Middleware {
  return (useSWRNext) =>
    function useSwrCacheRetention(key, fetcher, config) {
      const plainKey = unstable_serialize(key)
      const infiniteKey = serializeInfiniteLoader(key)

      useLayoutEffect(() => {
        const releases = [plainKey, infiniteKey].filter(Boolean).map((retainedKey) => cache.retain(retainedKey))
        return () => releases.forEach((release) => release())
      }, [infiniteKey, plainKey])

      return useSWRNext(key, fetcher, config)
    }
}
