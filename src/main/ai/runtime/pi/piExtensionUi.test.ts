import { describe, expect, it } from 'vitest'

import {
  buildPiDialogQuestion,
  buildPiDialogResponse,
  parsePiDialogRequest,
  type PiDialogRequest
} from './piExtensionUi'

const labels = { yes: 'Yes', no: 'No', keep: 'Use default' }

function dialog(fields: Record<string, unknown>): PiDialogRequest {
  const request = parsePiDialogRequest({ type: 'extension_ui_request', id: 'd1', title: 'Pick', ...fields })
  if (!request) throw new Error('not a dialog')
  return request
}

describe('pi extension dialogs', () => {
  it('ignores fire-and-forget UI requests', () => {
    for (const method of ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text']) {
      expect(parsePiDialogRequest({ type: 'extension_ui_request', id: 'x', method })).toBeUndefined()
    }
  })

  it('offers every select option and answers with the chosen one', () => {
    const options = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'Cancel']
    const request = dialog({ method: 'select', message: 'Which one?', options })

    const question = buildPiDialogQuestion(request, labels)

    expect(question.question).toBe('Pick\n\nWhich one?')
    expect(question.options.map((option) => option.label)).toEqual(options)
    expect(buildPiDialogResponse(request, 'Cancel', labels)).toEqual({
      type: 'extension_ui_response',
      id: 'd1',
      value: 'Cancel'
    })
    expect(buildPiDialogResponse(request, 'something typed', labels)).toEqual({
      type: 'extension_ui_response',
      id: 'd1',
      cancelled: true
    })
  })

  it('confirms only on yes', () => {
    const request = dialog({ method: 'confirm' })

    expect(buildPiDialogResponse(request, 'Yes', labels)).toMatchObject({ confirmed: true })
    expect(buildPiDialogResponse(request, 'No', labels)).toMatchObject({ confirmed: false })
  })

  it('returns typed text, or the prefill when the user keeps it', () => {
    const request = dialog({ method: 'editor', prefill: 'draft' })

    expect(buildPiDialogQuestion(request, labels).options).toEqual([{ label: 'Use default', description: 'draft' }])
    expect(buildPiDialogResponse(request, 'Use default', labels)).toMatchObject({ value: 'draft' })
    expect(buildPiDialogResponse(request, 'my text', labels)).toMatchObject({ value: 'my text' })
    expect(buildPiDialogQuestion(dialog({ method: 'input' }), labels).options).toEqual([])
  })

  it('cancels when the user dismisses the question', () => {
    for (const method of ['select', 'confirm', 'input']) {
      expect(buildPiDialogResponse(dialog({ method, options: ['a'] }), undefined, labels)).toEqual({
        type: 'extension_ui_response',
        id: 'd1',
        cancelled: true
      })
    }
  })
})
