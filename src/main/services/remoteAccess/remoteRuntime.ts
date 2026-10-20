import { acceptSecureChannel, deviceIdentityId, RemoteSocketStream } from '@cherrystudio/remote-transport'

import { RemoteAgentHub } from './agentJournal'
import { loadDesktopIdentity } from './deviceIdentity'
import { RemoteAdvertisement } from './RemoteAdvertisement'
import { RemoteConnection } from './RemoteConnection'
import { RemotePairing } from './RemotePairing'
import { RemoteTokens } from './RemoteTokens'

/**
 * Everything remote access needs from the Noise/libp2p transport and Bonjour. `RemoteAccessService`
 * imports this module on first real use (a LAN endpoint, an invitation or an upgrade), so neither
 * package is loaded while the feature is idle.
 */
export function createRemoteRuntime(discoveryStatus: (status: 'starting' | 'available' | 'unavailable') => void) {
  return {
    advertisement: new RemoteAdvertisement(discoveryStatus),
    pairing: new RemotePairing(),
    tokens: new RemoteTokens(),
    hub: new RemoteAgentHub(),
    acceptSecureChannel,
    deviceIdentityId,
    loadDesktopIdentity,
    RemoteConnection,
    RemoteSocketStream
  }
}

export type RemoteRuntime = ReturnType<typeof createRemoteRuntime>
