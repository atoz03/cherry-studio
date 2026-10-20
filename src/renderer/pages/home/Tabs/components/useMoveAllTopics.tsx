import { Bot } from 'lucide-react'
import type { RefObject } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { restoreRecycleBinItems, showRecycleBinBatchUndo } from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { getActiveBranchMessages } from '@renderer/utils/chat/activeBranchMessages'
import { findDuplicateTopicIds } from '@renderer/utils/chat/topicDuplicates'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'

import MoveAllTopicsPopup, { type MoveAllTopicsChoice } from './MoveAllTopicsPopup'

interface UseMoveAllTopicsOptions {
  assistants: readonly Assistant[]
  pinnedTopicIds: readonly string[]
  topicsRef: RefObject<readonly Pick<Topic, 'id' | 'name' | 'assistantId' | 'lastActivityAt'>[]>
  activeTopicIdRef: RefObject<string>
}

/**
 * "Move all topics to…" for an assistant: optionally archives duplicates (see
 * `findDuplicateTopicIds`; pinned and the open topic are never archived), then
 * re-homes the remaining topics in one DataApi transaction.
 */
export function useMoveAllTopics({ assistants, pinnedTopicIds, topicsRef, activeTopicIdRef }: UseMoveAllTopicsOptions) {
  const { t } = useTranslation()
  const { deleteTopics, restoreTopic, refreshTopics } = useTopicMutations()
  const invalidate = useInvalidateCache()

  const moveTopics = useCallback(
    async (sourceAssistantId: string, { targetAssistantId, dedupe }: MoveAllTopicsChoice) => {
      let archivedIds: string[] = []
      if (dedupe) {
        const topics = topicsRef.current
        const duplicateIds = await findDuplicateTopicIds({
          sourceTopics: topics.filter((topic) => topic.assistantId === sourceAssistantId),
          targetTopics: topics.filter((topic) => topic.assistantId === targetAssistantId),
          protectedIds: new Set([...pinnedTopicIds, activeTopicIdRef.current]),
          loadMessages: getActiveBranchMessages
        })
        if (duplicateIds.length > 0) archivedIds = (await deleteTopics(duplicateIds)).deletedIds
      }

      const { movedIds } = await dataApiService.post('/topics:reassign', {
        body: { sourceAssistantId, targetAssistantId }
      })
      await invalidate(['/topics', ...movedIds.map((id) => `/topics/${id}`)])

      const target = assistants.find((assistant) => assistant.id === targetAssistantId)
      toast.success(t('assistants.move_all.success', { count: movedIds.length, to: target?.name ?? '' }))
      if (archivedIds.length > 0) {
        showRecycleBinBatchUndo({
          itemCount: archivedIds.length,
          onUndo: () =>
            restoreRecycleBinItems({
              ids: archivedIds,
              restore: restoreTopic,
              getActive: (id) => dataApiService.get(`/topics/${id}`),
              refresh: refreshTopics
            })
        })
      }
    },
    [activeTopicIdRef, assistants, deleteTopics, invalidate, pinnedTopicIds, refreshTopics, restoreTopic, t, topicsRef]
  )

  const openMoveAllTopics = useCallback(
    async (sourceAssistantId: string) => {
      const source = assistants.find((assistant) => assistant.id === sourceAssistantId)
      if (!source) return
      await MoveAllTopicsPopup.show({
        sourceName: source.name,
        targets: assistants
          .filter((assistant) => assistant.id !== sourceAssistantId)
          .map((assistant) => ({
            id: assistant.id,
            label: assistant.name,
            icon: assistant.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={14} />
          })),
        action: (choice) => moveTopics(sourceAssistantId, choice)
      })
    },
    [assistants, moveTopics]
  )

  // Nothing to move to with a single assistant: callers hide the action.
  return assistants.length > 1 ? openMoveAllTopics : undefined
}
