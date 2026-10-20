import dayjs from 'dayjs'
import { afterEach, describe, expect, it } from 'vitest'

import { setDayjsLocale } from '@renderer/i18n/resolver'

const MAY_FIRST = new Date(2024, 4, 1)

describe('setDayjsLocale', () => {
  afterEach(async () => {
    await setDayjsLocale('en-US')
  })

  it('loads the requested locale on demand and formats with it', async () => {
    await setDayjsLocale('de-DE')

    expect(dayjs.locale()).toBe('de')
    expect(dayjs(MAY_FIRST).format('MMMM')).toBe('Mai')
  })

  it('falls back to English for a language without a dayjs locale', async () => {
    await setDayjsLocale('de-DE')
    await setDayjsLocale('xx-XX')

    expect(dayjs.locale()).toBe('en')
    expect(dayjs(MAY_FIRST).format('MMMM')).toBe('May')
  })

  it('keeps the latest request when an earlier locale finishes loading later', async () => {
    const slower = setDayjsLocale('ja-JP')
    const latest = setDayjsLocale('en-US')
    await Promise.all([slower, latest])

    expect(dayjs.locale()).toBe('en')
  })
})
