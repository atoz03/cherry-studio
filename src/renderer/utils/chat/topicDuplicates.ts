import type { CherryMessagePart, Message } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'

type DuplicateCandidate = Pick<Topic, 'id' | 'name' | 'lastActivityAt'>

function partSignature(part: CherryMessagePart): string | undefined {
  if (part.type === 'step-start') return undefined
  if (part.type === 'text' || part.type === 'reasoning') return `${part.type}:${part.text}`
  return JSON.stringify(part)
}

/**
 * A comparable fingerprint of a conversation: every message's role and parts, in order.
 * Text and reasoning compare by their text; any other part (files, tools, data) must
 * match verbatim. Returns `undefined` when there is nothing to compare.
 */
export function topicContentSignature(messages: readonly Message[]): string | undefined {
  const turns = messages.flatMap((message) => {
    const parts = (message.data.parts ?? []).flatMap((part) => partSignature(part) ?? [])
    return parts.length > 0 ? [[message.role, parts]] : []
  })
  return turns.length > 0 ? JSON.stringify(turns) : undefined
}

/**
 * Source topics that duplicate another topic once both assistants are merged: same
 * trimmed title AND same active-branch content (see `topicContentSignature`).
 *
 * Copies already under the target are always kept. Among source copies, protected
 * topics (pinned, open) win, then the most recently active one. Protected topics and
 * topics without content are never reported. Messages are loaded only for topics whose
 * title collides with another topic's.
 */
export async function findDuplicateTopicIds({
  sourceTopics,
  targetTopics,
  protectedIds,
  loadMessages
}: {
  sourceTopics: readonly DuplicateCandidate[]
  targetTopics: readonly DuplicateCandidate[]
  protectedIds: ReadonlySet<string>
  loadMessages: (topicId: string) => Promise<readonly Message[]>
}): Promise<string[]> {
  const sourceIds = new Set(sourceTopics.map((topic) => topic.id))
  const rankedSource = [...sourceTopics].sort(
    (a, b) =>
      Number(protectedIds.has(b.id)) - Number(protectedIds.has(a.id)) ||
      b.lastActivityAt.localeCompare(a.lastActivityAt) ||
      a.id.localeCompare(b.id)
  )

  const byTitle = new Map<string, DuplicateCandidate[]>()
  for (const topic of [...targetTopics, ...rankedSource]) {
    const title = topic.name.trim()
    byTitle.set(title, [...(byTitle.get(title) ?? []), topic])
  }

  const duplicates: string[] = []
  for (const group of byTitle.values()) {
    const removable = group.some((topic) => sourceIds.has(topic.id) && !protectedIds.has(topic.id))
    if (group.length < 2 || !removable) continue

    const kept = new Set<string>()
    for (const topic of group) {
      const signature = topicContentSignature(await loadMessages(topic.id))
      if (!signature) continue
      if (kept.has(signature) && sourceIds.has(topic.id) && !protectedIds.has(topic.id)) {
        duplicates.push(topic.id)
      } else {
        kept.add(signature)
      }
    }
  }
  return duplicates
}
