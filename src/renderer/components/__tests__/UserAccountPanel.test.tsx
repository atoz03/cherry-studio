import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { UserAccountPanel } from '../UserAccountPanel'

const showUserPopup = vi.hoisted(() => vi.fn())

vi.mock('../UserPopup', () => ({ default: { show: showUserPopup } }))

const request = vi.mocked(window.api.ipcApi.request)

beforeEach(async () => {
  vi.clearAllMocks()
  MockUsePreferenceUtils.resetMocks()
  vi.stubGlobal('__APP_EDITION__', 'global')
  request.mockResolvedValue({ ok: true, data: undefined })
  await i18n.changeLanguage('zh-CN')
})

describe('UserAccountPanel', () => {
  it('opens the avatar and name dialog from the CN account menu', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    const user = userEvent.setup()

    render(<UserAccountPanel />)
    await user.click(screen.getByRole('button', { name: '用户名' }))

    expect(showUserPopup).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
  })

  it('opens the personal information page from the global account menu', async () => {
    const user = userEvent.setup()

    render(<UserAccountPanel />)
    await user.click(screen.getByRole('button', { name: '用户名' }))

    expect(request).toHaveBeenCalledWith('navigation.open_route_in_main', { path: '/settings/profile' })
    expect(showUserPopup).not.toHaveBeenCalled()
  })
})
