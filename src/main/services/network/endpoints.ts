import { DIAGNOSTIC_UPLOAD_URL } from '@main/services/diagnostics'
import { FORK_UPDATE_FEED_URL } from '@main/services/forkUpdateFeed'
import { resolveRegistryBaseUrl } from '@main/services/ProviderRegistryUpdaterService'

import type { NetworkEndpoint } from './types'

/** Built-in URLs use their owning services' resolution, including the registry's country detection. */
export async function builtinEndpoints(): Promise<readonly NetworkEndpoint[]> {
  return [
    { id: 'update', url: FORK_UPDATE_FEED_URL },
    { id: 'registry', url: `${await resolveRegistryBaseUrl()}/manifest.json` },
    { id: 'diagnostics', url: DIAGNOSTIC_UPLOAD_URL }
  ]
}
