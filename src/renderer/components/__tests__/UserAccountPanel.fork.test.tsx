import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { UserAccountPanel } from '../UserAccountPanel'

vi.mock('../UserPopup', () => ({ default: { show: vi.fn() } }))

const request = vi.mocked(window.api.ipcApi.request)
const cherryCloudRequests = () => request.mock.calls.filter(([route]) => String(route).startsWith('cherry_cloud.'))

beforeEach(async () => {
  vi.clearAllMocks()
  MockUsePreferenceUtils.resetMocks()
  vi.stubGlobal('__APP_EDITION__', 'global')
  await i18n.changeLanguage('en-US')
  request.mockResolvedValue({ ok: true, data: undefined })
})

describe('UserAccountPanel with FORK_CHERRY_CLOUD_ENABLED off', () => {
  it('shows the local profile without Cherry Cloud status, login, or subscription', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Alice')

    render(<UserAccountPanel />)

    expect(screen.getByRole('button', { name: i18n.t('settings.general.user_name.label') })).toHaveTextContent(
      /^Alice$/
    )
    expect(screen.queryByText(i18n.t('settings.provider.cherry_cloud.title'))).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: i18n.t('settings.provider.cherry_cloud.login') })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('settings.subscription.card_label'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('common.settings') })).toBeInTheDocument()
    expect(cherryCloudRequests()).toEqual([])
  })

  it('falls back to the name placeholder instead of a cloud status when no name is set', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', '')

    render(<UserAccountPanel />)

    expect(screen.getByRole('button', { name: i18n.t('settings.general.user_name.label') })).toHaveTextContent(
      i18n.t('settings.general.user_name.placeholder')
    )
  })

  it('still opens the local personal information page', async () => {
    const user = userEvent.setup()

    render(<UserAccountPanel />)
    await user.click(screen.getByRole('button', { name: i18n.t('settings.general.user_name.label') }))

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(cherryCloudRequests()).toEqual([])
  })
})
