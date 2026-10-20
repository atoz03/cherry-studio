import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import ProviderNoteField from '../ProviderNoteField'

const mocks = vi.hoisted(() => ({ useProvider: vi.fn(), updateProvider: vi.fn() }))

vi.mock('@renderer/hooks/useProvider', () => ({ useProvider: mocks.useProvider }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const settings = { notes: 'Billing: team card', rateLimit: 5 }

describe('ProviderNoteField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateProvider.mockResolvedValue(undefined)
    mocks.useProvider.mockReturnValue({ provider: { id: 'openai', settings }, updateProvider: mocks.updateProvider })
  })

  it('shows the saved note and saves an edit on blur without touching other settings', async () => {
    const user = userEvent.setup()
    render(<ProviderNoteField providerId="openai" />)

    const field = screen.getByLabelText('settings.provider.note.label')
    expect(field).toHaveValue('Billing: team card')

    await user.clear(field)
    await user.type(field, 'Personal key')
    await user.tab()

    expect(mocks.updateProvider).toHaveBeenCalledExactlyOnceWith({
      providerSettings: { notes: 'Personal key', rateLimit: 5 }
    })
  })

  it('does not write when the note is unchanged', async () => {
    const user = userEvent.setup()
    render(<ProviderNoteField providerId="openai" />)

    await user.click(screen.getByLabelText('settings.provider.note.label'))
    await user.tab()

    expect(mocks.updateProvider).not.toHaveBeenCalled()
  })

  it('reports a failed save', async () => {
    const user = userEvent.setup()
    mocks.updateProvider.mockRejectedValueOnce(new Error('offline'))
    render(<ProviderNoteField providerId="openai" />)

    await user.type(screen.getByLabelText('settings.provider.note.label'), '!')
    await user.tab()

    expect(toast.error).toHaveBeenCalled()
  })
})
