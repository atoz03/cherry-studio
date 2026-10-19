import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  exportConversations: vi.fn(),
  importConversations: vi.fn()
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

vi.mock('@renderer/services/chatgptExport', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  detectChatgptWorkspaces: mocks.detect,
  exportChatgptConversations: mocks.exportConversations,
  importChatgptConversations: mocks.importConversations
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key)
  })
}))

import { ChatgptExportError } from '@renderer/services/chatgptExport'

import ChatgptExportPopup from '../ChatgptExportPopup'

const webview = { getURL: () => 'https://chatgpt.com/' } as unknown as WebviewTag

function openPopup() {
  render(<PopupHost />)
  act(() => {
    void ChatgptExportPopup.show({ webview })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, undefined)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('ChatgptExportPopup', () => {
  it('tells the user to sign in when the ChatGPT page has no session', async () => {
    mocks.detect.mockRejectedValue(new ChatgptExportError('not_signed_in'))
    openPopup()

    expect(await screen.findByText('miniApp.chatgpt_export.error.not_signed_in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'miniApp.chatgpt_export.start' })).not.toBeInTheDocument()
    expect(mocks.exportConversations).not.toHaveBeenCalled()
  })

  it('exports the chosen team workspace, imports it, and summarizes the result including failed downloads', async () => {
    const user = userEvent.setup()
    mocks.detect.mockResolvedValue([{ id: 'ws-acme', name: 'Acme' }])
    const conversations = [{ title: 'Hello', create_time: 1, mapping: {} }]
    mocks.exportConversations.mockResolvedValue({ conversations, failedCount: 2 })
    mocks.importConversations.mockResolvedValue({ success: true, topicsCount: 1, messagesCount: 3 })
    openPopup()

    await user.click(await screen.findByRole('radio', { name: 'miniApp.chatgpt_export.workspace.team' }))
    const workspaceInput = screen.getByLabelText('miniApp.chatgpt_export.workspace.id')
    const start = screen.getByRole('button', { name: 'miniApp.chatgpt_export.start' })
    expect(workspaceInput).toHaveValue('ws-acme')

    await user.clear(workspaceInput)
    await user.type(workspaceInput, 'not a workspace')
    expect(start).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Acme (ws-acme)' }))
    expect(start).toBeEnabled()

    await user.click(start)

    expect(
      await screen.findByText('import.chatgpt.success:{"topics":1,"messages":3}', undefined, { timeout: 3000 })
    ).toBeInTheDocument()
    expect(screen.getByText('miniApp.chatgpt_export.failed_count:{"count":2}')).toBeInTheDocument()
    expect(mocks.exportConversations).toHaveBeenCalledWith(webview, expect.objectContaining({ workspaceId: 'ws-acme' }))
    expect(mocks.importConversations).toHaveBeenCalledWith(conversations, expect.any(Function))
  })

  it('cancelling a running download aborts it and imports nothing', async () => {
    const user = userEvent.setup()
    mocks.detect.mockResolvedValue([])
    let exportSignal: AbortSignal | undefined
    mocks.exportConversations.mockImplementation(
      (_webview: WebviewTag, options: { signal: AbortSignal; onProgress: (event: unknown) => void }) => {
        exportSignal = options.signal
        options.onProgress({ phase: 'downloading', done: 20, total: 80 })
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason))
        })
      }
    )
    openPopup()

    await user.click(await screen.findByRole('button', { name: 'miniApp.chatgpt_export.start' }))
    expect(
      await screen.findByRole('progressbar', { name: 'miniApp.chatgpt_export.downloading:{"done":20,"total":80}' })
    ).toHaveAttribute('aria-valuenow', '25')

    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(exportSignal?.aborted).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.importConversations).not.toHaveBeenCalled()
  })
})
