import type { ContentMessageRole, Message } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'

/** The synthetic root ChatGPT exports hang every conversation from. */
const ROOT_NODE_ID = 'client-created-root'

interface ChatgptExportMessage {
  id: string
  author: { role: ContentMessageRole }
  content: { content_type: 'text'; parts: string[] }
  create_time: number
}

interface ChatgptExportNode {
  id: string
  message: ChatgptExportMessage | null
  parent: string | null
  children: string[]
}

/** One entry of ChatGPT's `conversations.json` export, restricted to what the importer reads. */
export interface ChatgptExportConversation {
  title: string
  create_time: number
  update_time: number
  mapping: Record<string, ChatgptExportNode>
  current_node: string
}

const toEpochSeconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000)

function messageText(message: Message): string {
  return (message.data.parts ?? [])
    .flatMap((part) => (part.type === 'text' && part.text.trim() ? [part.text] : []))
    .join('\n\n')
}

/**
 * Convert one topic's active-branch messages into a linear ChatGPT conversation.
 * Only text parts are exported (reasoning, tools and files have no importable
 * counterpart); messages left without text are skipped and the chain closes over them.
 */
export function topicToChatgptConversation(
  topic: Pick<Topic, 'name' | 'createdAt' | 'lastActivityAt'>,
  messages: readonly Message[],
  untitledName: string
): ChatgptExportConversation {
  const mapping: Record<string, ChatgptExportNode> = {
    [ROOT_NODE_ID]: { id: ROOT_NODE_ID, message: null, parent: null, children: [] }
  }
  let lastNodeId = ROOT_NODE_ID

  for (const message of messages) {
    if (message.role === 'root') continue
    const text = messageText(message)
    if (!text) continue

    mapping[lastNodeId].children.push(message.id)
    mapping[message.id] = {
      id: message.id,
      message: {
        id: message.id,
        author: { role: message.role },
        content: { content_type: 'text', parts: [text] },
        create_time: toEpochSeconds(message.createdAt)
      },
      parent: lastNodeId,
      children: []
    }
    lastNodeId = message.id
  }

  return {
    title: topic.name.trim() || untitledName,
    create_time: toEpochSeconds(topic.createdAt),
    update_time: toEpochSeconds(topic.lastActivityAt),
    mapping,
    current_node: lastNodeId
  }
}
