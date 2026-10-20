import { createInstance } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'

import { formatThinkingSeconds, getThinkingTitle } from '../thinkingTitle'

const i18n = createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'zh-CN',
    resources: { 'zh-CN': { translation: zhCN }, 'en-US': { translation: en } },
    keySeparator: false,
    interpolation: { escapeValue: false }
  })
})

const zh = () => i18n.getFixedT('zh-CN')
const enT = () => i18n.getFixedT('en-US')

describe('getThinkingTitle', () => {
  it('names the effort and duration once thinking is done', () => {
    expect(getThinkingTitle(zh(), { isThinking: false, thinkingMs: 3500, reasoningEffort: 'high' })).toBe(
      '已沉思（用时 3.5 秒）'
    )
    expect(getThinkingTitle(enT(), { isThinking: false, thinkingMs: 3500, reasoningEffort: 'low' })).toBe(
      'Thought with low effort (3.5s)'
    )
  })

  it('names the effort while thinking', () => {
    expect(getThinkingTitle(zh(), { isThinking: true, thinkingMs: 3500, reasoningEffort: 'medium' })).toBe('斟酌中')
  })

  it('labels every concrete effort, including max and ultra', () => {
    const titles = (['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const).map((reasoningEffort) =>
      getThinkingTitle(zh(), { isThinking: true, reasoningEffort })
    )
    expect(titles).toEqual(['微念中', '浮想中', '斟酌中', '沉思中', '穷究中', '竭虑中', '极思中'])
  })

  it.each(['default', 'auto', 'none', undefined] as const)(
    'falls back to the generic labels for effort %s',
    (reasoningEffort) => {
      expect(getThinkingTitle(zh(), { isThinking: false, thinkingMs: 12000, reasoningEffort })).toBe(
        '已深度思考（用时 12.0 秒）'
      )
      expect(getThinkingTitle(zh(), { isThinking: true, reasoningEffort })).toBe(
        zh()('message.tools.placeholder.thinking')
      )
    }
  )

  it('keeps the static done label when no duration was measured', () => {
    expect(getThinkingTitle(zh(), { isThinking: false, reasoningEffort: 'high' })).toBe(
      zh()('common.reasoning_content')
    )
    expect(getThinkingTitle(zh(), { isThinking: false, thinkingMs: Number.NaN, reasoningEffort: 'high' })).toBe(
      zh()('common.reasoning_content')
    )
  })
})

describe('formatThinkingSeconds', () => {
  it('rounds to one decimal and never shows less than 0.1s', () => {
    expect(formatThinkingSeconds(0)).toBe('0.1')
    expect(formatThinkingSeconds(480)).toBe('0.5')
    expect(formatThinkingSeconds(61_049)).toBe('61.0')
  })
})
