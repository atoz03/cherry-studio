import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProfileSettings } from '../ProfileSettings'

vi.mock('@renderer/components/UserProfileEditor', () => ({
  UserProfileEditor: () => <button type="button" aria-label="Avatar editor" />
}))
vi.mock('../SubscriptionSettings', () => ({
  SubscriptionSettings: () => <div>Subscription and quota</div>
}))
vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('ProfileSettings with FORK_CHERRY_CLOUD_ENABLED off', () => {
  it('keeps local profile editing and drops the Cherry Cloud subscription section', () => {
    render(<ProfileSettings />)

    expect(screen.getByRole('button', { name: 'Avatar editor' })).toBeInTheDocument()
    expect(screen.queryByText('Subscription and quota')).not.toBeInTheDocument()
  })
})
