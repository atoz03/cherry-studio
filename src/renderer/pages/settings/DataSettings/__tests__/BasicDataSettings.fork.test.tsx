import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('../BackupPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../RestorePopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../V1RemigrationPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../ClearCachePopup', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: { show: vi.fn() }
}))

import BasicDataSettings from '../BasicDataSettings'
import { entries } from '../data.search'

describe('Data settings while nothing collects data', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', { databases: vi.fn().mockResolvedValue([]) })
    requestMock.mockImplementation((route: string) =>
      Promise.resolve(
        route === 'app.cache_cleanup.inspect'
          ? {
              results: [{ group: 'normal_cache', size: { bytes: 0, accuracy: 'estimated', completeness: 'complete' } }]
            }
          : undefined
      )
    )
  })

  it('has no data-collection toggle, while the rest of the page stays', async () => {
    render(<BasicDataSettings />)
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('app.get_info'))

    expect(screen.getByText('settings.data.data_reset.title')).toBeInTheDocument()
    expect(screen.queryByText('settings.privacy.title')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.privacy.enable_privacy_mode')).not.toBeInTheDocument()
    expect(document.getElementById('setting-data-data-privacy-mode')).toBeNull()
  })

  it('keeps the toggle out of settings search', () => {
    const anchorIds = entries.map(({ anchorId }) => anchorId)

    expect(anchorIds).not.toContain('data-privacy-mode')
    expect(anchorIds).toContain('data-reset')
  })
})
