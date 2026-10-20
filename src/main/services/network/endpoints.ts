import { FORK_UPDATE_FEED_URL } from '@main/services/forkUpdateFeed'

import type { NetworkEndpoint } from './types'

/** Built-in URLs use their owning services' resolution. */
export async function builtinEndpoints(): Promise<readonly NetworkEndpoint[]> {
  return [{ id: 'update', url: FORK_UPDATE_FEED_URL }]
}
