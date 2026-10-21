/**
 * Map pi extension dialogs (`extension_ui_request`, see pi's docs/rpc-extension-ui.md) onto Cherry's
 * AskUserQuestion interaction, and the user's answer back onto an `extension_ui_response`.
 */
export type PiDialogMethod = 'select' | 'confirm' | 'input' | 'editor'

export interface PiDialogRequest {
  id: string
  method: PiDialogMethod
  title: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
}

export interface PiDialogLabels {
  yes: string
  no: string
  keep: string
}

export interface PiDialogQuestion {
  question: string
  header: string
  options: Array<{ label: string; description?: string }>
  multiSelect: false
}

const DIALOG_METHODS = new Set<string>(['select', 'confirm', 'input', 'editor'])

export function parsePiDialogRequest(record: Record<string, unknown>): PiDialogRequest | undefined {
  if (typeof record.id !== 'string' || typeof record.method !== 'string' || !DIALOG_METHODS.has(record.method)) {
    return undefined
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return {
    id: record.id,
    method: record.method as PiDialogMethod,
    title: text(record.title) ?? '',
    message: text(record.message),
    options: Array.isArray(record.options) ? record.options.filter((option) => typeof option === 'string') : undefined,
    placeholder: text(record.placeholder),
    prefill: text(record.prefill)
  }
}

/** Dismissing the question cancels the dialog. Free-text dialogs offer to keep the prefill; typed text is the value. */
export function buildPiDialogQuestion(request: PiDialogRequest, labels: PiDialogLabels): PiDialogQuestion {
  const question = request.message ? `${request.title}\n\n${request.message}` : request.title
  const base = { question, header: 'Pi', multiSelect: false as const }
  switch (request.method) {
    case 'select':
      return { ...base, options: (request.options ?? []).map((label) => ({ label })) }
    case 'confirm':
      return { ...base, options: [{ label: labels.yes }, { label: labels.no }] }
    case 'input':
    case 'editor':
      return {
        ...base,
        options: request.prefill ? [{ label: labels.keep, description: request.prefill }] : []
      }
  }
}

export type PiDialogResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true }

/** `answer` is undefined when the user dismissed the question. */
export function buildPiDialogResponse(
  request: PiDialogRequest,
  answer: string | undefined,
  labels: PiDialogLabels
): PiDialogResponse {
  const cancelled = { type: 'extension_ui_response', id: request.id, cancelled: true } as const
  if (answer === undefined) return cancelled
  switch (request.method) {
    case 'select':
      return request.options?.includes(answer)
        ? { type: 'extension_ui_response', id: request.id, value: answer }
        : cancelled
    case 'confirm':
      return { type: 'extension_ui_response', id: request.id, confirmed: answer === labels.yes }
    case 'input':
    case 'editor':
      return {
        type: 'extension_ui_response',
        id: request.id,
        value: answer === labels.keep ? (request.prefill ?? '') : answer
      }
  }
}
