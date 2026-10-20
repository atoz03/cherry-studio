import { describe, expect, it, vi } from 'vitest'

import { applyForkUpdateFeed, FORK_UPDATE_FEED_URL } from '../forkUpdateFeed'

describe('applyForkUpdateFeed', () => {
  it('offers the release GitHub marks as latest, never an older one, for prerelease-tagged fork versions', () => {
    // What electron-updater starts with for a 2.1.8-atoz.1 build: prerelease matching on.
    const updater = { allowPrerelease: true, allowDowngrade: true, requestHeaders: { 'Client-Id': 'abc' } }

    applyForkUpdateFeed(updater)

    expect(updater).toEqual({
      allowPrerelease: false,
      allowDowngrade: false,
      requestHeaders: { 'Cache-Control': 'no-cache' }
    })
  })

  it('leaves the update channel to app-update.yml', () => {
    const setChannel = vi.fn()
    const updater = {
      allowPrerelease: true,
      allowDowngrade: false,
      requestHeaders: null,
      set channel(value: string | null) {
        setChannel(value)
      }
    }

    applyForkUpdateFeed(updater)

    expect(setChannel).not.toHaveBeenCalled()
  })

  it('probes the releases feed the GitHub provider requests first', () => {
    expect(FORK_UPDATE_FEED_URL).toBe('https://github.com/atoz03/cherry-studio/releases.atom')
  })
})
