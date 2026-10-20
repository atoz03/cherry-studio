import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { BranchMessagesResponse, CherryMessagePart, Message } from '@shared/data/types/message'
import { createClearContextPart } from '@shared/data/types/uiParts'

import { getActiveBranchMessages } from '../activeBranchMessages'

const message = (id: string, role: Message['role'], parts: CherryMessagePart[]): Message => ({
  id,
  topicId: 'topic-1',
  parentId: null,
  role,
  data: { parts },
  searchableText: '',
  status: 'success',
  siblingsGroupId: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const page = (messages: Message[], nextCursor?: string): BranchMessagesResponse => ({
  items: messages.map((m) => ({ message: m })),
  nextCursor,
  activeNodeId: 'a2',
  rootId: 'root',
  assistantId: null
})

describe('getActiveBranchMessages', () => {
  beforeEach(() => MockDataApiUtils.resetMocks())

  it('walks every page and returns the branch oldest first without non-content rows', async () => {
    const pages: Record<string, BranchMessagesResponse> = {
      // The first page is the newest tail of the branch; the cursor walks toward the root.
      start: page(
        [
          message('clear', 'user', [createClearContextPart()]),
          message('u2', 'user', [{ type: 'text', text: 'second question' }]),
          message('a2', 'assistant', [{ type: 'text', text: 'second answer' }]),
          message('blank', 'user', [])
        ],
        'older'
      ),
      older: page([
        message('root', 'root', []),
        message('u1', 'user', [{ type: 'text', text: 'first question' }]),
        message('a1', 'assistant', [{ type: 'text', text: 'first answer' }])
      ])
    }
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) => {
      const cursor: string | undefined = options?.query?.cursor
      return pages[cursor ?? 'start'] as never
    })

    const messages = await getActiveBranchMessages('topic-1')

    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(dataApiService.get).toHaveBeenCalledWith('/topics/topic-1/messages', expect.anything())
    expect(dataApiService.get).toHaveBeenCalledTimes(2)
  })
})
