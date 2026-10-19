import { describe, expect, it, vi } from 'vitest'

import { ChatgptImporter } from '@renderer/services/import/importers/ChatgptImporter'
import type { CherryMessagePart, Message } from '@shared/data/types/message'

import { topicToChatgptConversation } from '../chatgptExport'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

let sequence = 0
function message(role: Message['role'], parts: CherryMessagePart[], createdAt = '2026-01-02T03:04:05.000Z'): Message {
  sequence += 1
  return {
    id: `message-${sequence}`,
    topicId: 'topic-1',
    parentId: null,
    role,
    data: { parts },
    searchableText: '',
    status: 'success',
    siblingsGroupId: 0,
    createdAt,
    updatedAt: createdAt
  }
}

const text = (value: string): CherryMessagePart => ({ type: 'text', text: value })
const topic = (name: string) => ({
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivityAt: '2026-01-03T00:00:00.000Z'
})

async function roundTrip(conversations: unknown[]) {
  const importer = new ChatgptImporter()
  const json = JSON.stringify(conversations)
  expect(importer.validate(json)).toBe(true)
  return (await importer.parse(json)).conversations
}

describe('topicToChatgptConversation', () => {
  it('round-trips a linear conversation through the ChatGPT importer', async () => {
    const user = message('user', [text('What is 2 + 2?')])
    const assistant = message('assistant', [
      { type: 'reasoning', text: 'simple arithmetic', state: 'done' },
      text('It is 4.'),
      text('Anything else?')
    ])
    const followUp = message('user', [text('Thanks')])

    const [imported] = await roundTrip([
      topicToChatgptConversation(topic('Math'), [user, assistant, followUp], 'Untitled')
    ])

    expect(imported.name).toBe('Math')
    expect(imported.messages.map(({ role, parts }) => ({ role, parts }))).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'What is 2 + 2?' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'It is 4.\n\nAnything else?' }] },
      { role: 'user', parts: [{ type: 'text', text: 'Thanks' }] }
    ])
    // Each message hangs off the previous exported one, and the last one is active.
    expect(imported.messages.map((m) => m.parentSourceId)).toEqual([undefined, user.id, assistant.id])
    expect(imported.activeSourceId).toBe(followUp.id)
  })

  it('skips messages without text and keeps the chain linear over them', async () => {
    const user = message('user', [text('Search this')])
    const toolOnly = message('assistant', [{ type: 'reasoning', text: 'calling a tool', state: 'done' }])
    const answer = message('assistant', [text('Found it')])

    const [imported] = await roundTrip([topicToChatgptConversation(topic('Search'), [user, toolOnly, answer], 'x')])

    expect(imported.messages.map((m) => m.sourceId)).toEqual([user.id, answer.id])
    expect(imported.messages[1].parentSourceId).toBe(user.id)
  })

  it('exports several topics into one importable file, naming untitled ones', async () => {
    const conversations = [
      topicToChatgptConversation(topic('First'), [message('user', [text('a')])], 'Untitled'),
      topicToChatgptConversation(topic('  '), [message('user', [text('b')])], 'Untitled'),
      topicToChatgptConversation(topic('Empty'), [], 'Untitled')
    ]

    const imported = await roundTrip(conversations)

    expect(imported.map((conversation) => conversation.name)).toEqual(['First', 'Untitled', 'Empty'])
    expect(imported.map((conversation) => conversation.messages.length)).toEqual([1, 1, 0])
  })

  it('writes ChatGPT epoch-second timestamps', () => {
    const conversation = topicToChatgptConversation(
      topic('Times'),
      [message('user', [text('hi')], '2026-01-02T03:04:05.900Z')],
      'x'
    )

    expect(conversation.create_time).toBe(Date.parse('2026-01-01T00:00:00.000Z') / 1000)
    expect(conversation.update_time).toBe(Date.parse('2026-01-03T00:00:00.000Z') / 1000)
    expect(conversation.mapping[conversation.current_node].message?.create_time).toBe(
      Math.floor(Date.parse('2026-01-02T03:04:05.900Z') / 1000)
    )
  })
})
