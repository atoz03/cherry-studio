import type { WebviewTag } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { MiniApp } from '@shared/data/types/miniApp'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }
}))

import {
  ChatgptExportError,
  detectChatgptWorkspaces,
  exportChatgptConversations,
  importChatgptConversations,
  isChatgptExportSupported
} from '..'

type Handler = { status: number; body?: unknown } | Array<{ status: number; body?: unknown }>

interface PageRequest {
  path: string
  headers: Record<string, string>
}

/**
 * A stand-in for the ChatGPT page: runs the real injected script with `fetch` answered
 * from fixtures. Repeated array handlers answer successive calls to the same path.
 */
function createChatgptPage(
  routes: Record<string, Handler>,
  options: { url?: string; origin?: string; localStorageEntries?: Record<string, string> } = {}
) {
  const { url = 'https://chatgpt.com/', origin = new URL(url).origin, localStorageEntries = {} } = options
  const requests: PageRequest[] = []
  const calls = new Map<string, number>()
  const fetch = async (path: string, init: { headers?: Record<string, string> } = {}) => {
    requests.push({ path, headers: init.headers ?? {} })
    const handler = routes[path]
    const count = calls.get(path) ?? 0
    calls.set(path, count + 1)
    const response = Array.isArray(handler) ? handler[Math.min(count, handler.length - 1)] : handler
    const { status, body } = response ?? { status: 404 }
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  const keys = Object.keys(localStorageEntries)
  const localStorage = {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => localStorageEntries[key] ?? null
  }
  const document = { cookie: 'oai-did=device-1; other=x', getElementById: () => null }
  const setTimeout = (callback: () => void) => queueMicrotask(callback)
  const executeJavaScript = vi.fn(async (code: string) =>
    // Parameters shadow the page globals the script reads; nothing else leaks in.
    new Function('fetch', 'location', 'document', 'localStorage', 'setTimeout', `return ${code}`)(
      fetch,
      { origin },
      document,
      localStorage,
      setTimeout
    )
  )
  const webview = { getURL: () => url, executeJavaScript } as unknown as WebviewTag
  return { webview, requests, executeJavaScript }
}

function conversationDetail(id: string, title: string | null = `Conversation ${id}`) {
  return {
    ...(title === null ? {} : { title }),
    create_time: 1_700_000_000.5,
    current_node: `${id}-answer`,
    mapping: {
      [`${id}-root`]: { id: `${id}-root`, message: null, parent: null, children: [`${id}-question`] },
      [`${id}-question`]: {
        id: `${id}-question`,
        parent: `${id}-root`,
        children: [`${id}-answer`],
        message: { author: { role: 'user' }, content: { content_type: 'text', parts: [`question ${id}`] } }
      },
      [`${id}-answer`]: {
        id: `${id}-answer`,
        parent: `${id}-question`,
        children: [],
        message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [`answer ${id}`] } }
      }
    }
  }
}

const SESSION = { '/api/auth/session': { status: 200, body: { accessToken: 'token-1' } } }
const listPath = (offset: number, archived = false) =>
  `/backend-api/conversations?offset=${offset}&limit=50&order=updated${archived ? '&is_archived=true' : ''}`
const detailRoutes = (ids: string[]) =>
  Object.fromEntries(
    ids.map((id) => [`/backend-api/conversation/${id}`, { status: 200, body: conversationDetail(id) }])
  )

/** Two list pages (the server caps the page below the requested size), archived chats and a project. */
function fullAccountRoutes(): Record<string, Handler> {
  return {
    ...SESSION,
    [listPath(0)]: { status: 200, body: { items: [{ id: 'c1' }, { id: 'c2' }], has_more: true } },
    [listPath(2)]: { status: 200, body: { items: [{ id: 'c3' }], has_more: false } },
    [listPath(0, true)]: { status: 200, body: { items: [{ id: 'c4' }], has_more: false } },
    '/backend-api/gizmos/snorlax/sidebar': {
      status: 200,
      body: { items: [{ gizmo: { gizmo: { id: 'g-p-1' } } }], cursor: null }
    },
    '/backend-api/gizmos/g-p-1/conversations?cursor=0': {
      status: 200,
      body: { items: [{ id: 'c5' }, { id: 'c1' }], cursor: 'next' }
    },
    '/backend-api/gizmos/g-p-1/conversations?cursor=next': {
      status: 200,
      body: { items: [{ id: 'c6' }], cursor: null }
    },
    ...detailRoutes(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportChatgptConversations', () => {
  it('downloads every conversation once: all list pages, archived chats, and project chats', async () => {
    const page = createChatgptPage(fullAccountRoutes())

    const result = await exportChatgptConversations(page.webview, { workspaceId: null })

    expect(result.failedCount).toBe(0)
    expect(result.conversations.map((conversation) => conversation.title).sort()).toEqual(
      ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => `Conversation ${id}`)
    )
    const detailRequests = page.requests.filter((request) => request.path.startsWith('/backend-api/conversation/'))
    expect(detailRequests).toHaveLength(6)
  })

  it('sends the team workspace id on every backend request, and none for the personal account', async () => {
    const team = createChatgptPage(fullAccountRoutes())
    await exportChatgptConversations(team.webview, { workspaceId: 'ws-team-1' })
    const teamBackendRequests = team.requests.filter((request) => request.path.startsWith('/backend-api/'))
    expect(teamBackendRequests.length).toBeGreaterThan(0)
    expect(teamBackendRequests.every((request) => request.headers['ChatGPT-Account-Id'] === 'ws-team-1')).toBe(true)
    expect(teamBackendRequests.every((request) => request.headers.Authorization === 'Bearer token-1')).toBe(true)

    const personal = createChatgptPage(fullAccountRoutes())
    await exportChatgptConversations(personal.webview, { workspaceId: null })
    expect(personal.requests.some((request) => 'ChatGPT-Account-Id' in request.headers)).toBe(false)
  })

  it('counts conversations that cannot be downloaded instead of failing the export, and retries rate limits', async () => {
    const page = createChatgptPage({
      ...SESSION,
      [listPath(0)]: { status: 200, body: { items: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], has_more: false } },
      ...detailRoutes(['c1']),
      '/backend-api/conversation/c2': { status: 404 },
      '/backend-api/conversation/c3': [{ status: 429 }, { status: 200, body: conversationDetail('c3') }]
    })

    const result = await exportChatgptConversations(page.webview, { workspaceId: null })

    expect(result.conversations.map((conversation) => conversation.title)).toEqual([
      'Conversation c1',
      'Conversation c3'
    ])
    expect(result.failedCount).toBe(1)
  })

  it('reports listing, then download progress up to the total', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `c${index}`)
    const page = createChatgptPage({
      ...SESSION,
      [listPath(0)]: { status: 200, body: { items: ids.map((id) => ({ id })), has_more: false } },
      ...detailRoutes(ids)
    })
    const onProgress = vi.fn()

    await exportChatgptConversations(page.webview, { workspaceId: null, onProgress })

    const progress = onProgress.mock.calls.map(([event]) => event)
    expect(progress[0]).toEqual({ phase: 'listing' })
    expect(progress.at(-1)).toEqual({ phase: 'downloading', done: 25, total: 25 })
    const done = progress.flatMap((event) => (event.phase === 'downloading' ? [event.done] : []))
    expect(done.every((value, index) => index === 0 || value > done[index - 1])).toBe(true)
  })

  it('stops downloading once aborted', async () => {
    const ids = Array.from({ length: 45 }, (_, index) => `c${index}`)
    const page = createChatgptPage({
      ...SESSION,
      [listPath(0)]: { status: 200, body: { items: ids.map((id) => ({ id })), has_more: false } },
      ...detailRoutes(ids)
    })
    const controller = new AbortController()

    await expect(
      exportChatgptConversations(page.webview, {
        workspaceId: null,
        signal: controller.signal,
        onProgress: (event) => {
          if (event.phase === 'downloading' && event.done > 0) controller.abort()
        }
      })
    ).rejects.toThrow()

    const detailRequests = page.requests.filter((request) => request.path.startsWith('/backend-api/conversation/'))
    expect(detailRequests.length).toBeLessThan(ids.length)
  })

  it('never runs the script once the mini app has navigated away from chatgpt.com', async () => {
    const page = createChatgptPage(fullAccountRoutes(), { url: 'https://example.com/' })

    await expect(exportChatgptConversations(page.webview, { workspaceId: null })).rejects.toMatchObject({
      code: 'wrong_page'
    })
    expect(page.executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses inside the page too when the page origin is not chatgpt.com', async () => {
    const page = createChatgptPage(fullAccountRoutes(), { origin: 'https://example.com' })

    await expect(exportChatgptConversations(page.webview, { workspaceId: null })).rejects.toMatchObject({
      code: 'wrong_page'
    })
    expect(page.requests).toEqual([])
  })

  it('rejects a malformed workspace id before touching the page', async () => {
    const page = createChatgptPage(fullAccountRoutes())

    await expect(exportChatgptConversations(page.webview, { workspaceId: 'ws-1"; x' })).rejects.toBeInstanceOf(
      ChatgptExportError
    )
    expect(page.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('detectChatgptWorkspaces', () => {
  it('lists team workspaces with their names, skipping the personal account', async () => {
    const page = createChatgptPage(
      {
        ...SESSION,
        '/backend-api/accounts/check/v4-2023-04-27': {
          status: 200,
          body: {
            accounts: {
              default: { account: { account_id: 'personal-1', structure: 'personal' } },
              'ws-acme': { account: { account_id: 'ws-acme', structure: 'workspace', name: 'Acme' } }
            }
          }
        }
      },
      { localStorageEntries: { _account: '"ws-12345678-1234-1234-1234-123456789abc"', theme: 'dark' } }
    )

    await expect(detectChatgptWorkspaces(page.webview)).resolves.toEqual([
      { id: 'ws-acme', name: 'Acme' },
      { id: 'ws-12345678-1234-1234-1234-123456789abc', name: null }
    ])
  })

  it('reports not_signed_in when the page has no session', async () => {
    const page = createChatgptPage({ '/api/auth/session': { status: 200, body: {} } })

    await expect(detectChatgptWorkspaces(page.webview)).rejects.toMatchObject({ code: 'not_signed_in' })
  })
})

describe('importChatgptConversations', () => {
  it('imports exported conversations as topics under one new assistant, like a conversations.json file', async () => {
    const page = createChatgptPage({
      ...SESSION,
      [listPath(0)]: { status: 200, body: { items: [{ id: 'c1' }, { id: 'c2' }], has_more: false } },
      '/backend-api/conversation/c1': { status: 200, body: conversationDetail('c1') },
      // A detail without a title must not make the importer reject the whole batch.
      '/backend-api/conversation/c2': { status: 200, body: conversationDetail('c2', null) }
    })
    const posts: Array<{ path: string; body: any }> = []
    let sequence = 0
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      posts.push({ path, body: options?.body })
      if (path === '/assistants') return { id: 'assistant-1', name: 'ChatGPT Import', emoji: '💬' }
      return { id: `${path === '/topics' ? 'topic' : 'message'}-${++sequence}` }
    })

    const { conversations } = await exportChatgptConversations(page.webview, { workspaceId: null })
    const response = await importChatgptConversations(conversations)

    expect(response).toMatchObject({ success: true, topicsCount: 2, messagesCount: 4 })
    expect(posts.filter((post) => post.path === '/assistants')).toHaveLength(1)
    expect(posts.filter((post) => post.path === '/topics').map((post) => post.body.name)).toEqual([
      'Conversation c1',
      'import.chatgpt.untitled_conversation'
    ])
    expect(posts.filter((post) => post.path.endsWith('/messages')).map((post) => post.body.data.parts[0].text)).toEqual(
      ['question c1', 'answer c1', 'question c2', 'answer c2']
    )
  })
})

describe('isChatgptExportSupported', () => {
  const site = (overrides: Partial<MiniApp>) =>
    ({ appId: 'openai', kind: 'site', presetMiniAppId: 'openai', url: 'https://chatgpt.com/', ...overrides }) as MiniApp

  it('offers the export for the built-in ChatGPT site only', () => {
    expect(isChatgptExportSupported(site({}))).toBe(true)
    expect(isChatgptExportSupported(site({ appId: 'my-chatgpt', presetMiniAppId: null }))).toBe(false)
    expect(isChatgptExportSupported(site({ appId: 'gemini', presetMiniAppId: 'gemini' }))).toBe(false)
    expect(isChatgptExportSupported(site({ kind: 'app' }))).toBe(false)
  })
})
