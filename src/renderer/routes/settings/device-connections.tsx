import { createFileRoute, redirect } from '@tanstack/react-router'

import { DeviceConnectionsSettings } from '@renderer/pages/settings/DeviceConnectionsSettings'
import { FORK_REMOTE_ACCESS_ENABLED } from '@shared/utils/forkFeatures'

export const Route = createFileRoute('/settings/device-connections')({
  beforeLoad: () => {
    if (!FORK_REMOTE_ACCESS_ENABLED) throw redirect({ to: '/settings/provider' })
  },
  component: DeviceConnectionsSettings
})
