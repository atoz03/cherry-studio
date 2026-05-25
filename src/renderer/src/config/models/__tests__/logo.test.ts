import { describe, expect, it } from 'vitest'

import { getModelLogoById } from '../logo'

describe('getModelLogoById gpt5-series mapping', () => {
  it('maps current gpt-5 series variants explicitly', () => {
    expect(getModelLogoById('gpt-5.5')).toContain('gpt-5.png')
    expect(getModelLogoById('gpt-5.5-chat-latest')).toContain('gpt-5-chat.png')
    expect(getModelLogoById('gpt-5.5-codex')).toContain('gpt-5-codex.png')

    expect(getModelLogoById('gpt-5.4')).toContain('gpt-5.png')
    expect(getModelLogoById('gpt-5.4-pro')).toContain('gpt-5.png')
    expect(getModelLogoById('gpt-5.4-codex')).toContain('gpt-5-codex.png')

    expect(getModelLogoById('gpt-5.3-codex')).toContain('gpt-5-codex.png')

    expect(getModelLogoById('gpt-5.2')).toContain('gpt-5.png')
    expect(getModelLogoById('gpt-5.2-chat-latest')).toContain('gpt-5-chat.png')
    expect(getModelLogoById('gpt-5.2-codex')).toContain('gpt-5-codex.png')
  })

  it('does not use removed gpt-5.1 dedicated assets', () => {
    const logo = getModelLogoById('gpt-5.1-codex-max')
    expect(logo).toContain('gpt-5-codex.png')
    expect(logo).not.toContain('gpt-5.1-codex.png')
  })
})
