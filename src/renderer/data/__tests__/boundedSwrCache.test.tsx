import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import useSWR, { SWRConfig } from 'swr'
import useSWRInfinite, { unstable_serialize as serializeInfiniteKey } from 'swr/infinite'
import { describe, expect, it, vi } from 'vitest'

import { BoundedSwrCache, createSwrCacheRetentionMiddleware } from '../boundedSwrCache'

const entry = (data: unknown) => ({ data })

describe('BoundedSwrCache', () => {
  it('evicts the least recently used key once it holds more than the limit', () => {
    const cache = new BoundedSwrCache(2)
    cache.set('a', entry(1))
    cache.set('b', entry(2))
    cache.get('a')
    cache.set('c', entry(3))

    expect([...cache.keys()]).toEqual(['a', 'c'])
    expect(cache.get('b')).toBeUndefined()
  })

  it('never evicts a retained key and lets it go once released', () => {
    const cache = new BoundedSwrCache(1)
    const release = cache.retain('a')
    cache.set('a', entry(1))
    cache.set('b', entry(2))

    expect(cache.get('a')).toEqual(entry(1))
    expect(cache.get('b')).toBeUndefined()

    release()
    cache.set('c', entry(3))

    expect([...cache.keys()]).toEqual(['c'])
  })

  it('keeps a key retained by two holders until both release it', () => {
    const cache = new BoundedSwrCache(0)
    const releaseFirst = cache.retain('a')
    const releaseSecond = cache.retain('a')
    cache.set('a', entry(1))

    releaseFirst()
    releaseFirst()
    expect(cache.get('a')).toEqual(entry(1))

    releaseSecond()
    expect(cache.get('a')).toBeUndefined()
  })

  it('lets callers read every entry while iterating its keys', () => {
    const cache = new BoundedSwrCache(10)
    cache.set('a', entry(1))
    cache.set('b', entry(2))

    const visited: string[] = []
    for (const key of cache.keys()) {
      visited.push(key)
      cache.get(key)
    }

    expect(visited).toEqual(['a', 'b'])
  })
})

describe('createSwrCacheRetentionMiddleware', () => {
  function createWrapper(maxEntries: number) {
    const cache = new BoundedSwrCache(maxEntries)
    const config = { provider: () => cache, use: [createSwrCacheRetentionMiddleware(cache)], dedupingInterval: 0 }
    const Wrapper = ({ children }: { children: ReactNode }) => <SWRConfig value={config}>{children}</SWRConfig>
    return { cache, Wrapper }
  }

  function Probe({ swrKey, fetcher }: { swrKey: string; fetcher: (key: string) => Promise<string> }) {
    const { data } = useSWR(swrKey, fetcher)
    return <div>{data ? `${swrKey}:${data}` : `${swrKey}:loading`}</div>
  }

  it('keeps mounted queries cached past the limit and refetches an evicted one on remount', async () => {
    const { Wrapper } = createWrapper(1)
    const fetchA = vi.fn(async () => 'one')
    const fetchB = vi.fn(async () => 'two')
    const view = (showB: boolean) => (
      <Wrapper>
        <Probe swrKey="a" fetcher={fetchA} />
        {showB && <Probe swrKey="b" fetcher={fetchB} />}
      </Wrapper>
    )

    const { rerender } = render(view(true))
    expect(await screen.findByText('a:one')).toBeTruthy()
    expect(await screen.findByText('b:two')).toBeTruthy()

    rerender(view(false))
    rerender(view(true))

    expect(screen.getByText('a:one')).toBeTruthy()
    expect(await screen.findByText('b:two')).toBeTruthy()
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).toHaveBeenCalledTimes(2)
  })

  it('retains the aggregate entry of a mounted infinite query', async () => {
    const { cache, Wrapper } = createWrapper(1)
    const getKey = (index: number) => `page-${index}`

    function InfiniteProbe() {
      const { data } = useSWRInfinite(getKey, async (key: string) => `${key}-data`)
      return <div>{data ? data.join(',') : 'loading'}</div>
    }

    render(
      <Wrapper>
        <InfiniteProbe />
      </Wrapper>
    )
    expect(await screen.findByText('page-0-data')).toBeTruthy()

    cache.set('other-1', entry(1))
    cache.set('other-2', entry(2))

    await waitFor(() => expect(cache.get(serializeInfiniteKey(getKey))?.data).toEqual(['page-0-data']))
  })
})
