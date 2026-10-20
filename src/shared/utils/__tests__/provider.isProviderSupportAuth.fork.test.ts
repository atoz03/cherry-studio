import { describe, expect, it } from 'vitest'

import { API_KEY_OAUTH_PROVIDER_IDS, isProviderSupportAuth } from '../provider'

describe('isProviderSupportAuth', () => {
  it.each(['aihubmix', 'ppio'])('hides the %s login, whose OAuth needs an upstream-only client secret', (id) => {
    expect(isProviderSupportAuth({ id })).toBe(false)
  })

  it('keeps the logins that work without a client secret', () => {
    const working = API_KEY_OAUTH_PROVIDER_IDS.filter((id) => id !== 'aihubmix' && id !== 'ppio')
    expect(working).toEqual(['302ai', 'silicon', 'aionly', 'tokendance'])
    for (const id of working) expect(isProviderSupportAuth({ id })).toBe(true)
  })

  it('still rejects providers without an OAuth launcher', () => {
    expect(isProviderSupportAuth({ id: 'openai' })).toBe(false)
  })
})
