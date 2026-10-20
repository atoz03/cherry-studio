import { describe, expect, it } from 'vitest'

import type { SerializedError } from '@renderer/types/error'

import { diagnosticReportFields, resolveDiagnosticReportLocation } from '../diagnosticReportDescription'

describe('diagnosticReportFields', () => {
  it('projects normalized location, combined model, and combined error fields in display order', () => {
    const error = {
      name: ' ProviderError ',
      message: ' failed ',
      stack: null,
      status: 503,
      statusCode: 429
    } as SerializedError

    expect(
      diagnosticReportFields({
        diagnosisContext: { modelId: ' gpt-5 ', providerId: ' OpenAI ' },
        error,
        location: ' Home conversation '
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'model', value: 'OpenAI:gpt-5' },
      { id: 'errorMessage', value: 'ProviderError: failed' }
    ])
  })

  it('keeps whichever model and error parts are available', () => {
    expect(
      diagnosticReportFields({
        diagnosisContext: { modelId: 'gpt-5' },
        error: { name: null, message: 'failed', stack: null },
        location: 'Home conversation'
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'model', value: 'gpt-5' },
      { id: 'errorMessage', value: 'failed' }
    ])

    expect(
      diagnosticReportFields({
        error: { name: 'AuthError', message: 'Unauthorized', stack: null },
        localizedErrorMessage: 'API Key 无效，请检查并重新配置',
        location: 'Home conversation'
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'errorMessage', value: 'API Key 无效，请检查并重新配置 (Unauthorized)' }
    ])

    expect(
      diagnosticReportFields({
        diagnosisContext: { providerId: 'OpenAI' },
        error: { name: 'ProviderError', message: null, stack: null },
        location: 'Home conversation'
      })
    ).toEqual([
      { id: 'location', value: 'Home conversation' },
      { id: 'model', value: 'OpenAI' },
      { id: 'errorMessage', value: 'ProviderError' }
    ])

    expect(
      diagnosticReportFields({
        error: { name: null, message: null, stack: null },
        location: 'Home conversation'
      })
    ).toEqual([{ id: 'location', value: 'Home conversation' }])
  })
})

describe('resolveDiagnosticReportLocation', () => {
  const t = (key: string, options?: { defaultValue?: string }) =>
    key === 'error.diagnostic_report.locations.work'
      ? '工作对话'
      : key === 'error.diagnostic_report.locations.home'
        ? '普通对话'
        : (options?.defaultValue ?? key)

  it('maps Agent location ids and leftover Chinese copy to the work-conversation label', () => {
    expect(resolveDiagnosticReportLocation(t, 'agent', 'zh-CN')).toBe('工作对话')
    expect(resolveDiagnosticReportLocation(t, 'Agent 对话', 'zh-CN')).toBe('工作对话')
  })

  it('maps the home location id', () => {
    expect(resolveDiagnosticReportLocation(t, 'home')).toBe('普通对话')
  })

  it('leaves already-translated locations unchanged', () => {
    expect(resolveDiagnosticReportLocation(t, 'Agent conversation')).toBe('Agent conversation')
  })
})
