import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseAtsutilFontFamilies } from '../macFonts'

const fixture = readFileSync(join(__dirname, 'fixtures', 'atsutil-fonts-list.txt'), 'utf8')

describe('parseAtsutilFontFamilies', () => {
  it('returns the deduplicated, sorted family names and not the PostScript font names', () => {
    expect(parseAtsutilFontFamilies(fixture)).toEqual([
      '.AppleSystemUIFont',
      'Helvetica Neue',
      'Menlo',
      'PingFang SC',
      'Songti SC',
      'STHeiti'
    ])
  })

  it('stops at the next section header and accepts CRLF output', () => {
    const output = ['System Families:', '\tPingFang SC', 'Other Section:', '\tNot A Family', ''].join('\r\n')

    expect(parseAtsutilFontFamilies(output)).toEqual(['PingFang SC'])
  })

  it('returns nothing when there is no family section', () => {
    expect(parseAtsutilFontFamilies('System Fonts:\n\tMenlo-Regular\n')).toEqual([])
    expect(parseAtsutilFontFamilies('')).toEqual([])
  })
})
