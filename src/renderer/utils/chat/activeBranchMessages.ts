import { dataApiService } from '@data/DataApiService'
import type { BranchMessagesResponse, Message } from '@shared/data/types/message'
import { hasClearContextPart, isBlankUserTurn } from '@shared/data/types/uiParts'

const PAGE_SIZE = 200

/**
 * The messages on a topic's active branch, oldest first — sibling alternatives
 * (regenerations, other models' replies) excluded. Context-clear markers and
 * blank user turns are dropped, matching what the conversation view renders.
 */
export async function getActiveBranchMessages(topicId: string): Promise<Message[]> {
  // The branch endpoint pages from the newest tail toward the root; items within a page are oldest first.
  const pages: Message[][] = []
  let cursor: string | undefined
  do {
    const response = (await dataApiService.get(`/topics/${topicId}/messages`, {
      query: { limit: PAGE_SIZE, cursor }
    })) as BranchMessagesResponse
    pages.push(response.items.map((item) => item.message))
    cursor = response.nextCursor
  } while (cursor)

  return pages
    .reverse()
    .flat()
    .filter((message) => {
      const parts = message.data.parts ?? []
      return (
        message.role !== 'root' &&
        !hasClearContextPart(parts) &&
        !isBlankUserTurn({ role: message.role, status: message.status, parts })
      )
    })
}
