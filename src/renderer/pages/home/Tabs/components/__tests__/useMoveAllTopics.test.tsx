import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUI from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@shared/data/types/assistant'

const mocks = vi.hoisted(() => ({
  deleteTopics: vi.fn(),
  restoreTopic: vi.fn(),
  refreshTopics: vi.fn(),
  showRecycleBinBatchUndo: vi.fn()
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const React = await import('react')
  return {
    ...(await importOriginal<typeof CherryStudioUI>()),
    // The real dropdown is a Radix popover; a button list keeps the target pick deterministic.
    SelectDropdown: ({ items, onSelect }: { items: { id: string; label: string }[]; onSelect: (id: string) => void }) =>
      React.createElement(
        'div',
        null,
        items.map((item) =>
          React.createElement('button', { key: item.id, onClick: () => onSelect(item.id) }, item.label)
        )
      )
  }
})
vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicMutations: () => ({
    deleteTopics: mocks.deleteTopics,
    restoreTopic: mocks.restoreTopic,
    refreshTopics: mocks.refreshTopics
  })
}))
vi.mock('@renderer/services/recycleBinFeedback', () => ({
  showRecycleBinBatchUndo: mocks.showRecycleBinBatchUndo,
  restoreRecycleBinItems: vi.fn()
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useMoveAllTopics } from '../useMoveAllTopics'

const assistant = (id: string, name: string) => ({ id, name, emoji: '🤖' }) as Assistant
const SOURCE = assistant('asst-source', 'Source')
const TARGET = assistant('asst-target', 'Target')

const topic = (id: string, name: string, assistantId: string) => ({
  id,
  name,
  assistantId,
  lastActivityAt: '2026-01-01T00:00:00.000Z'
})

const branch = (texts: string[]) => ({
  items: texts.map((text, index) => ({
    message: {
      id: `m-${index}`,
      topicId: 't',
      parentId: null,
      role: index % 2 === 0 ? 'user' : 'assistant',
      data: { parts: [{ type: 'text', text }] },
      searchableText: text,
      status: 'success',
      siblingsGroupId: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  })),
  activeNodeId: null,
  rootId: null,
  assistantId: null
})

function Harness({ assistants, activeTopicId = '' }: { assistants: Assistant[]; activeTopicId?: string }) {
  const openMoveAllTopics = useMoveAllTopics({
    assistants,
    pinnedTopicIds: [],
    topicsRef: {
      current: [topic('dup', 'Trip', SOURCE.id), topic('unique', 'Notes', SOURCE.id), topic('kept', 'Trip', TARGET.id)]
    },
    activeTopicIdRef: { current: activeTopicId }
  })
  if (!openMoveAllTopics) return <span>unavailable</span>
  return (
    <button type="button" onClick={() => void openMoveAllTopics(SOURCE.id)}>
      open
    </button>
  )
}

async function openAndPickTarget(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'open' }))
  await user.click(await screen.findByRole('button', { name: 'Target' }))
}

describe('useMoveAllTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteTopics.mockImplementation(async (ids: string[]) => ({ deletedIds: ids, deletedCount: ids.length }))
    vi.mocked(dataApiService.get).mockImplementation(
      async (path: string) => branch(path.includes('/unique/') ? ['other'] : ['Plan Rome', 'Day 1']) as never
    )
    vi.mocked(dataApiService.post).mockResolvedValue({ movedIds: ['unique'] })
    render(<PopupHost />)
  })

  afterEach(() => {
    cleanup()
    vi.useFakeTimers()
    for (const entry of [...popupService.getSnapshot()]) popupService.settle(entry.instanceId, undefined)
    vi.advanceTimersByTime(POPUP_EXIT_MS)
    vi.useRealTimers()
  })

  it('archives duplicates first, then moves the remaining topics to the chosen assistant', async () => {
    const user = userEvent.setup()
    render(<Harness assistants={[SOURCE, TARGET]} />)

    await openAndPickTarget(user)
    await user.click(screen.getByRole('button', { name: 'assistants.move_all.confirm' }))

    await waitFor(() => expect(dataApiService.post).toHaveBeenCalled())
    expect(mocks.deleteTopics).toHaveBeenCalledExactlyOnceWith(['dup'])
    expect(mocks.deleteTopics.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dataApiService.post).mock.invocationCallOrder[0]
    )
    expect(dataApiService.post).toHaveBeenCalledWith('/topics:reassign', {
      body: { sourceAssistantId: SOURCE.id, targetAssistantId: TARGET.id }
    })
    expect(mocks.showRecycleBinBatchUndo).toHaveBeenCalledWith(expect.objectContaining({ itemCount: 1 }))
  })

  it('moves everything and archives nothing when de-duplication is turned off', async () => {
    const user = userEvent.setup()
    render(<Harness assistants={[SOURCE, TARGET]} />)

    await openAndPickTarget(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'assistants.move_all.confirm' }))

    await waitFor(() => expect(dataApiService.post).toHaveBeenCalled())
    expect(mocks.deleteTopics).not.toHaveBeenCalled()
    expect(mocks.showRecycleBinBatchUndo).not.toHaveBeenCalled()
  })

  it('never archives the open topic', async () => {
    const user = userEvent.setup()
    render(<Harness assistants={[SOURCE, TARGET]} activeTopicId="dup" />)

    await openAndPickTarget(user)
    await user.click(screen.getByRole('button', { name: 'assistants.move_all.confirm' }))

    await waitFor(() => expect(dataApiService.post).toHaveBeenCalled())
    expect(mocks.deleteTopics).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and reports the error when the move fails', async () => {
    const user = userEvent.setup()
    vi.mocked(dataApiService.post).mockRejectedValueOnce(new Error('database is locked'))
    render(<Harness assistants={[SOURCE, TARGET]} />)

    await openAndPickTarget(user)
    await user.click(screen.getByRole('button', { name: 'assistants.move_all.confirm' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByText('assistants.move_all.title')).toBeInTheDocument()
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'assistants.move_all.confirm' })).toBeEnabled()
  })

  it('is unavailable when there is no other assistant to move to', () => {
    render(<Harness assistants={[SOURCE]} />)

    expect(screen.getByText('unavailable')).toBeInTheDocument()
  })
})
