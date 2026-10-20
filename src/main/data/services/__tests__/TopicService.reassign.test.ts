// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/MessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantTable } from '@data/db/schemas/assistant'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { topicService } from '@data/services/TopicService'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const SOURCE = 'asst-source'
const TARGET = 'asst-target'
const OTHER = 'asst-other'

describe('TopicService.reassignAssistant', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    notifyDataApiDataChangeMock.mockClear()
    await dbh.db.insert(assistantTable).values(
      [SOURCE, TARGET, OTHER].map((id, index) => ({
        id,
        name: id,
        emoji: '🤖',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: `a${index}`
      }))
    )
    await dbh.db.insert(topicTable).values([
      { id: 'topic-source-1', name: 'One', assistantId: SOURCE, orderKey: 'a0' },
      { id: 'topic-source-2', name: 'Two', assistantId: SOURCE, orderKey: 'a3' },
      { id: 'topic-source-trashed', name: 'Gone', assistantId: SOURCE, orderKey: 'a4', deletedAt: 1 },
      { id: 'topic-target', name: 'Existing', assistantId: TARGET, orderKey: 'a1' },
      { id: 'topic-other', name: 'Other', assistantId: OTHER, orderKey: 'a2' }
    ])
  })

  const ownerById = async () =>
    Object.fromEntries(
      (
        await dbh.db
          .select({ id: topicTable.id, assistantId: topicTable.assistantId, orderKey: topicTable.orderKey })
          .from(topicTable)
          .orderBy(asc(topicTable.id))
      ).map((row) => [row.id, `${row.assistantId}@${row.orderKey}`])
    )

  it('moves every active topic of the source assistant and keeps their order keys', async () => {
    const result = topicService.reassignAssistant({ sourceAssistantId: SOURCE, targetAssistantId: TARGET })

    expect([...result.movedIds].sort()).toEqual(['topic-source-1', 'topic-source-2'])
    expect(await ownerById()).toEqual({
      'topic-other': `${OTHER}@a2`,
      'topic-source-1': `${TARGET}@a0`,
      'topic-source-2': `${TARGET}@a3`,
      'topic-source-trashed': `${SOURCE}@a4`,
      'topic-target': `${TARGET}@a1`
    })
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith(
      expect.arrayContaining([{ endpoint: '/topics', kind: 'projection', entityIds: result.movedIds }])
    )
  })

  it('keeps topic pins when moving', async () => {
    await dbh.db.insert(pinTable).values({ entityType: 'topic', entityId: 'topic-source-1', orderKey: 'a0' })

    topicService.reassignAssistant({ sourceAssistantId: SOURCE, targetAssistantId: TARGET })

    const pins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, 'topic-source-1'))
    expect(pins).toHaveLength(1)
  })

  it('returns no ids and sends no change notification when the source has no active topics left', () => {
    topicService.reassignAssistant({ sourceAssistantId: SOURCE, targetAssistantId: TARGET })
    notifyDataApiDataChangeMock.mockClear()

    const result = topicService.reassignAssistant({ sourceAssistantId: SOURCE, targetAssistantId: TARGET })

    expect(result.movedIds).toEqual([])
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('rejects moving topics onto their own assistant', () => {
    expect(() => topicService.reassignAssistant({ sourceAssistantId: SOURCE, targetAssistantId: SOURCE })).toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR })
    )
  })

  it('rejects a missing or archived target without moving anything', async () => {
    await dbh.db.update(assistantTable).set({ deletedAt: 1 }).where(eq(assistantTable.id, OTHER))

    for (const targetAssistantId of [OTHER, 'asst-missing']) {
      let error: unknown
      try {
        topicService.reassignAssistant({ sourceAssistantId: SOURCE, targetAssistantId })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(DataApiError)
      expect((error as DataApiError).code).toBe(ErrorCode.NOT_FOUND)
    }
    expect((await ownerById())['topic-source-1']).toBe(`${SOURCE}@a0`)
  })
})
