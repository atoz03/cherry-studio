import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'

import NotesHistory from '../NotesHistory'

const FILE = '/notes/a.md'
const COMMITS = [
  { hash: 'a'.repeat(40), date: '2026-10-19T10:00:00+08:00', message: '2026-10-19 10:00:00' },
  { hash: 'b'.repeat(40), date: '2026-10-19T09:00:00+08:00', message: '2026-10-19 09:00:00' }
]

let steps: string[]
let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

const routeIpc = () => {
  vi.mocked(ipcApi.request).mockImplementation((async (route: string) => {
    if (route === 'notes.git.get_file_history') return COMMITS
    if (route === 'notes.git.get_file_diff') return { diff: '@@ -1 +1 @@\n-old\n+new\n', truncated: false }
    if (route === 'notes.git.restore_file') steps.push('restore')
    return undefined
  }) as typeof ipcApi.request)
}

const restoreSecondVersion = async (props: { flushDraft: () => Promise<void>; reloadDraft: () => Promise<void> }) => {
  const user = userEvent.setup()
  render(<NotesHistory filePath={FILE} {...props} />)
  await user.click(screen.getByRole('button', { name: 'Version history' }))
  await user.click(await screen.findByRole('button', { name: /2026-10-19 09:00:00/ }))
  await user.click(screen.getByRole('button', { name: 'Restore this version' }))
  const dialog = await screen.findByRole('dialog', { name: 'Restore this version?' })
  await user.click(within(dialog).getByRole('button', { name: 'Restore this version' }))
}

beforeEach(() => {
  steps = []
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('feature.notes.git.enabled', true)
  vi.mocked(ipcApi.request).mockReset()
  routeIpc()
})

describe('NotesHistory restore', () => {
  it('saves pending edits, then restores the chosen version, then reloads the editor', async () => {
    const flushDraft = vi.fn(async () => void steps.push('flush'))
    const reloadDraft = vi.fn(async () => void steps.push('reload'))

    await restoreSecondVersion({ flushDraft, reloadDraft })

    await waitFor(() => expect(steps).toEqual(['flush', 'restore', 'reload']))
    expect(ipcApi.request).toHaveBeenCalledWith('notes.git.restore_file', { path: FILE, revision: COMMITS[1].hash })
  })

  it('restores nothing when pending edits cannot be saved', async () => {
    const flushDraft = vi.fn(async () => {
      steps.push('flush')
      throw new Error('disk full')
    })
    const reloadDraft = vi.fn(async () => void steps.push('reload'))

    await restoreSecondVersion({ flushDraft, reloadDraft })

    await waitFor(() => expect(flushDraft).toHaveBeenCalled())
    expect(steps).toEqual(['flush'])
  })

  it('is hidden while versioning is off', () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.git.enabled', false)

    render(<NotesHistory filePath={FILE} flushDraft={vi.fn()} reloadDraft={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull()
  })
})
