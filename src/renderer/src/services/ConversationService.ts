import { loggerService } from '@logger'
import { convertMessagesToSdkMessages } from '@renderer/aiCore/prepareParams'
import type { Assistant, Message } from '@renderer/types'
import { filterAdjacentUserMessaegs, filterLastAssistantMessage } from '@renderer/utils/messageUtils/filters'
import type { ModelMessage } from 'ai'
import { findLast, isEmpty, takeRight } from 'lodash'

import { getAssistantSettings, getDefaultModel } from './AssistantService'
import {
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from './MessagesService'

const logger = loggerService.withContext('ConversationService')
const CONTEXT_RESERVED_MESSAGE_SLOTS = 2
const UNLIMITED_CONTEXT_SENTINEL = 100000
const MAX_COMPACT_SUMMARY_CHARS = 12000

export class ConversationService {
  /**
   * Applies the filtering pipeline that prepares UI messages for model consumption.
   * This keeps the logic testable and prevents future regressions when the pipeline changes.
   */
  static filterMessagesPipeline(messages: Message[], contextCount: number, extraWindow = 0): Message[] {
    const messagesAfterContextClear = filterAfterContextClearMessages(messages)
    const usefulMessages = filterUsefulMessages(messagesAfterContextClear)
    // Run the error-only filter before trimming trailing assistant responses so the pair is removed together.
    const withoutErrorOnlyPairs = filterErrorOnlyMessagesWithRelated(usefulMessages)
    const withoutTrailingAssistant = filterLastAssistantMessage(withoutErrorOnlyPairs)
    const withoutAdjacentUsers = filterAdjacentUserMessaegs(withoutTrailingAssistant)
    const limitedByContext = takeRight(
      withoutAdjacentUsers,
      contextCount + CONTEXT_RESERVED_MESSAGE_SLOTS + Math.max(0, extraWindow)
    )
    const contextClearFiltered = filterAfterContextClearMessages(limitedByContext)
    const nonEmptyMessages = filterEmptyMessages(contextClearFiltered)
    const userRoleStartMessages = filterUserRoleStartMessages(nonEmptyMessages)
    return userRoleStartMessages
  }

  private static shouldCompactContext(contextCount: number): boolean {
    return Number.isFinite(contextCount) && contextCount > 0 && contextCount < UNLIMITED_CONTEXT_SENTINEL
  }

  private static extractMessageText(message: ModelMessage): string {
    const parts = typeof message.content === 'string' ? [message.content] : message.content
    if (!Array.isArray(parts)) return ''

    const texts: string[] = []
    for (const part of parts) {
      if (typeof part === 'string') {
        texts.push(part)
      } else if (part.type === 'text' && 'text' in part) {
        texts.push(String(part.text || ''))
      } else if (part.type === 'reasoning' && 'text' in part) {
        texts.push(`[Reasoning] ${String(part.text || '')}`)
      } else if (part.type === 'tool-call' && 'toolName' in part) {
        texts.push(`[Tool call] ${String(part.toolName || 'unknown')}`)
      } else if (part.type === 'tool-result' && 'toolName' in part) {
        texts.push(`[Tool result] ${String(part.toolName || 'unknown')}`)
      }
    }
    return texts.join('\n').trim()
  }

  private static buildCompactSummary(prefixMessages: ModelMessage[]): string {
    const lines: string[] = ['Conversation history has been compacted for context efficiency.']

    for (const message of prefixMessages) {
      const role = message.role === 'tool' ? 'tool' : message.role
      const content = ConversationService.extractMessageText(message)
      if (!content) continue
      lines.push(`[${role}] ${content}`)
    }

    const summary = lines.join('\n')
    if (summary.length <= MAX_COMPACT_SUMMARY_CHARS) {
      return summary
    }
    return `${summary.slice(0, MAX_COMPACT_SUMMARY_CHARS)}\n...[compacted summary truncated]`
  }

  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant
  ): Promise<{ modelMessages: ModelMessage[]; uiMessages: Message[] }> {
    const { contextCount } = getAssistantSettings(assistant)
    // This logic is extracted from the original ApiService.fetchChatCompletion
    // const contextMessages = filterContextMessages(messages)
    const lastUserMessage = findLast(messages, (m) => m.role === 'user')
    if (!lastUserMessage) {
      return {
        modelMessages: [],
        uiMessages: []
      }
    }

    const shouldCompact = ConversationService.shouldCompactContext(contextCount)
    const pipelineContextCount = shouldCompact ? UNLIMITED_CONTEXT_SENTINEL : contextCount
    const uiMessagesFromPipeline = ConversationService.filterMessagesPipeline(messages, pipelineContextCount)
    logger.debug('uiMessagesFromPipeline', uiMessagesFromPipeline)

    // Fallback: ensure at least the last user message is present to avoid empty payloads
    let uiMessages = uiMessagesFromPipeline
    if ((!uiMessages || uiMessages.length === 0) && lastUserMessage) {
      uiMessages = [lastUserMessage]
    }

    const model = assistant.model || getDefaultModel()
    let modelMessages = await convertMessagesToSdkMessages(uiMessages, model)

    if (shouldCompact) {
      const keepCount = contextCount + CONTEXT_RESERVED_MESSAGE_SLOTS

      if (uiMessages.length > keepCount) {
        const overflowCount = uiMessages.length - keepCount
        const prefixUiMessages = uiMessages.slice(0, overflowCount)
        const tailUiMessages = uiMessages.slice(overflowCount)
        logger.info('Compacting conversation context window', {
          totalMessages: uiMessages.length,
          overflowCount,
          keepCount
        })

        const prefixModelMessages = await convertMessagesToSdkMessages(prefixUiMessages, model)
        const tailModelMessages = await convertMessagesToSdkMessages(tailUiMessages, model)

        modelMessages = [
          {
            role: 'system',
            content: ConversationService.buildCompactSummary(prefixModelMessages)
          },
          ...tailModelMessages
        ]
      }
    }

    return { modelMessages, uiMessages }
  }

  static needsWebSearch(assistant: Assistant): boolean {
    return !!assistant.webSearchProviderId
  }

  static needsKnowledgeSearch(assistant: Assistant): boolean {
    return !isEmpty(assistant.knowledge_bases)
  }
}
