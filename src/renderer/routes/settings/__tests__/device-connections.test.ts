import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/pages/settings/DeviceConnectionsSettings', () => ({ DeviceConnectionsSettings: () => null }))

import { settingsMenu } from '@renderer/components/settingsMenu'

import { Route } from '../device-connections'

/** The fork's real switch (off): Device Connections is neither listed nor reachable by a direct link. */
describe('device connections with remote access switched off', () => {
  it('is not offered in the settings menu or its search', () => {
    expect(settingsMenu.map(({ route }) => route)).not.toContain('/settings/device-connections')
  })

  it('redirects a direct link to regular settings', () => {
    let result: unknown
    try {
      ;(Route.options.beforeLoad as () => void)()
    } catch (error) {
      result = error
    }

    expect(isRedirect(result)).toBe(true)
    expect(result).toMatchObject({ options: { to: '/settings/provider' } })
  })
})
