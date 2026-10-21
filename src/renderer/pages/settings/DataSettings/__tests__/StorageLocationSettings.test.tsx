import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { StorageLocationInfo } from '@shared/types/storageLocation'

const { requestMock, selectFolderMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  selectFolderMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock }
}))

import StorageLocationSettings from '../StorageLocationSettings'

const LOCATIONS: StorageLocationInfo[] = [
  { location: 'models', path: '/data/models', defaultPath: '/user/Runtime/models', isDefault: false, bytes: 2048 },
  { location: 'toolchain', path: '/user/Toolchain', defaultPath: '/user/Toolchain', isDefault: true, bytes: 0 },
  { location: 'session_data', path: '/user', defaultPath: '/user', isDefault: true, bytes: null }
]

function respond(inspection: unknown) {
  requestMock.mockImplementation((route: string) => {
    if (route === 'app.storage_location.list') return Promise.resolve(LOCATIONS)
    if (route === 'app.storage_location.inspect') return Promise.resolve(inspection)
    return Promise.resolve(undefined)
  })
}

async function rowOf(label: string) {
  const title = await screen.findByText(`settings.data.storage_locations.${label}.label`)
  return title.closest('[id^="setting-data-storage-"]') as HTMLElement
}

function requestedRoutes() {
  return requestMock.mock.calls.map(([route]) => route)
}

describe('StorageLocationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('api', { ...window.api, file: { ...window.api.file, selectFolder: selectFolderMock } })
    selectFolderMock.mockResolvedValue('/mnt/big/tools')
  })

  // Bug caught: a reset offered for a location already at its default would
  // request a move onto itself.
  it('offers Reset only for a location that has been moved', async () => {
    respond({ valid: true, targetEmpty: true })
    render(<StorageLocationSettings />)

    expect(within(await rowOf('models')).getByRole('button', { name: 'common.reset' })).toBeInTheDocument()
    expect(within(await rowOf('toolchain')).queryByRole('button', { name: 'common.reset' })).not.toBeInTheDocument()
  })

  // Bug caught: a target the main process rejects must never reach the request
  // or the restart.
  it('explains a rejected target and records nothing', async () => {
    respond({ valid: false, reason: 'target_protected' })
    render(<StorageLocationSettings />)

    await userEvent.click(
      within(await rowOf('toolchain')).getByRole('button', { name: 'settings.data.storage_locations.change' })
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.data.app_data.select_error_protected_path'))
    expect(popup.confirm).not.toHaveBeenCalled()
    expect(requestedRoutes()).not.toContain('app.storage_location.request')
    expect(requestedRoutes()).not.toContain('app.relaunch')
  })

  it('moves nothing when the user cancels the confirmation', async () => {
    respond({ valid: true, targetEmpty: true })
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    render(<StorageLocationSettings />)

    await userEvent.click(
      within(await rowOf('toolchain')).getByRole('button', { name: 'settings.data.storage_locations.change' })
    )

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledOnce())
    expect(requestedRoutes()).not.toContain('app.storage_location.request')
  })

  it('records the move to the default path on Reset and restarts once it is confirmed', async () => {
    respond({ valid: true, targetEmpty: true })
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    render(<StorageLocationSettings />)

    await userEvent.click(within(await rowOf('models')).getByRole('button', { name: 'common.reset' }))

    await waitFor(() => expect(requestedRoutes()).toContain('app.relaunch'), { timeout: 2000 })
    expect(requestMock).toHaveBeenCalledWith('app.storage_location.request', {
      location: 'models',
      path: '/user/Runtime/models'
    })
    expect(requestedRoutes().indexOf('app.storage_location.request')).toBeLessThan(
      requestedRoutes().indexOf('app.relaunch')
    )
  })
})
