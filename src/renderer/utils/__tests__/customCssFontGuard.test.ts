import { describe, expect, it } from 'vitest'

import { withFontGuard } from '../customCssFontGuard'

const css = 'body { font-family: Comic Sans MS; }'

describe('withFontGuard', () => {
  it('re-asserts the chosen main and code fonts after the custom CSS', () => {
    const guarded = withFontGuard(css, { fontFamily: 'PingFang SC', codeFontFamily: 'JetBrains Mono' })!

    expect(guarded.startsWith(css)).toBe(true)
    expect(guarded.indexOf('var(--font-family) !important')).toBeGreaterThan(css.length)
    expect(guarded).toContain('code, pre, kbd, samp { font-family: var(--code-font-family) !important; }')
  })

  it('guards only the font that was actually chosen', () => {
    const guarded = withFontGuard(css, { fontFamily: 'PingFang SC', codeFontFamily: '  ' })!

    expect(guarded).toContain('var(--font-family) !important')
    expect(guarded).not.toContain('--code-font-family')
  })

  it('leaves the custom CSS in control when no font is chosen, and adds nothing to empty CSS', () => {
    expect(withFontGuard(css, {})).toBe(css)
    expect(withFontGuard('', { fontFamily: 'PingFang SC' })).toBe('')
    expect(withFontGuard(undefined, { fontFamily: 'PingFang SC' })).toBeUndefined()
  })
})
