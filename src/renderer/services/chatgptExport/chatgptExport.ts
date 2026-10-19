import type { WebviewTag } from 'electron'

import type { ImportResponse } from '@renderer/services/import'
import type { MiniApp } from '@shared/data/types/miniApp'

import { buildChatgptPageScript, type ChatgptPageRequest } from './pageScript'

const CHATGPT_ORIGIN = 'https://chatgpt.com'
const CHATGPT_PRESET_ID = 'openai'
/** Conversations downloaded per page-script run; each run is one progress step. */
const DOWNLOAD_BATCH_SIZE = 20
const ID_PATTERN = /^[\w-]{1,128}$/

export interface ChatgptWorkspace {
  id: string
  name: string | null
}

export type ChatgptExportProgress = { phase: 'listing' } | { phase: 'downloading'; done: number; total: number }

/** A conversation detail shaped like one entry of ChatGPT's `conversations.json`. */
export type ChatgptConversation = Record<string, unknown> & { title: string; create_time: number; mapping: object }

export interface ChatgptExportResult {
  conversations: ChatgptConversation[]
  /** Listed conversations whose details could not be downloaded. */
  failedCount: number
}

/** `code` is the page script's error code, e.g. `not_signed_in`, `wrong_page`, `http_403`. */
export class ChatgptExportError extends Error {
  constructor(readonly code: string) {
    super(`ChatGPT export failed: ${code}`)
    this.name = 'ChatgptExportError'
  }
}

/** Only the built-in ChatGPT site: a custom app pointing at chatgpt.com has no preset id. */
export const isChatgptExportSupported = (app: MiniApp): boolean =>
  app.kind === 'site' && app.presetMiniAppId === CHATGPT_PRESET_ID

export const isValidWorkspaceId = (id: string): boolean => ID_PATTERN.test(id)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isChatgptPage = (url: string): boolean => {
  try {
    return new URL(url).origin === CHATGPT_ORIGIN
  } catch {
    return false
  }
}

/**
 * Runs one step of the bundled export script in the guest. The user may have navigated
 * the mini app elsewhere, so the script never runs outside chatgpt.com.
 */
async function runInPage(webview: WebviewTag, request: ChatgptPageRequest): Promise<Record<string, unknown>> {
  if (!isChatgptPage(webview.getURL())) throw new ChatgptExportError('wrong_page')
  const result: unknown = await webview.executeJavaScript(buildChatgptPageScript(request))
  if (!isRecord(result)) throw new ChatgptExportError('unexpected')
  if (result.ok !== true) throw new ChatgptExportError(typeof result.error === 'string' ? result.error : 'unexpected')
  return result
}

/** Fills the fields `ChatgptImporter` requires so one odd conversation cannot fail the whole import. */
function toImportableConversations(details: unknown): ChatgptConversation[] {
  if (!Array.isArray(details)) return []
  return details.flatMap((detail) =>
    isRecord(detail) && isRecord(detail.mapping)
      ? [
          {
            ...detail,
            mapping: detail.mapping,
            title: typeof detail.title === 'string' ? detail.title : '',
            create_time: typeof detail.create_time === 'number' ? detail.create_time : 0
          }
        ]
      : []
  )
}

/** Team workspaces visible to the signed-in account; throws `not_signed_in` when nobody is signed in. */
export async function detectChatgptWorkspaces(webview: WebviewTag): Promise<ChatgptWorkspace[]> {
  const result = await runInPage(webview, { op: 'detect', workspaceId: null })
  if (!Array.isArray(result.workspaces)) return []
  return result.workspaces.flatMap((workspace) =>
    isRecord(workspace) && typeof workspace.id === 'string' && isValidWorkspaceId(workspace.id)
      ? [{ id: workspace.id, name: typeof workspace.name === 'string' ? workspace.name : null }]
      : []
  )
}

/**
 * Downloads every conversation of the personal account (`workspaceId: null`) or of a team
 * workspace, including archived and project conversations. Rejects with the signal's reason
 * when aborted between batches.
 */
export async function exportChatgptConversations(
  webview: WebviewTag,
  options: { workspaceId: string | null; signal?: AbortSignal; onProgress?: (progress: ChatgptExportProgress) => void }
): Promise<ChatgptExportResult> {
  const { workspaceId, signal, onProgress } = options
  if (workspaceId !== null && !isValidWorkspaceId(workspaceId)) throw new ChatgptExportError('invalid_workspace')

  onProgress?.({ phase: 'listing' })
  const listed = await runInPage(webview, { op: 'list', workspaceId })
  const ids = Array.isArray(listed.ids)
    ? listed.ids.filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id))
    : []

  const conversations: ChatgptConversation[] = []
  let failedCount = 0
  onProgress?.({ phase: 'downloading', done: 0, total: ids.length })
  for (let start = 0; start < ids.length; start += DOWNLOAD_BATCH_SIZE) {
    signal?.throwIfAborted()
    const batch = ids.slice(start, start + DOWNLOAD_BATCH_SIZE)
    const result = await runInPage(webview, { op: 'fetch', workspaceId, ids: batch })
    const received = toImportableConversations(result.conversations)
    conversations.push(...received)
    failedCount += batch.length - received.length
    onProgress?.({ phase: 'downloading', done: start + batch.length, total: ids.length })
  }
  signal?.throwIfAborted()
  return { conversations, failedCount }
}

/** Imports through the same path as a `conversations.json` file: one new assistant, one topic per conversation. */
export async function importChatgptConversations(
  conversations: ChatgptConversation[],
  onProgress?: (percent: number) => void
): Promise<ImportResponse> {
  // Loaded on use so the mini app toolbar, which only needs the gate above, stays light.
  const { importService } = await import('@renderer/services/import')
  return importService.importConversations(JSON.stringify(conversations), 'chatgpt', onProgress)
}
