import { describe, expect, it, vi } from 'vitest'

import type { CherryMessagePart, Message } from '@shared/data/types/message'

import { findDuplicateTopicIds, topicContentSignature } from '../topicDuplicates'

const message = (role: Message['role'], parts: CherryMessagePart[], id = `${role}-${Math.random()}`): Message => ({
  id,
  topicId: 'topic',
  parentId: null,
  role,
  data: { parts },
  searchableText: '',
  status: 'success',
  siblingsGroupId: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})
const text = (value: string): CherryMessagePart => ({ type: 'text', text: value })
const chat = (question: string, answer: string) => [
  message('user', [text(question)]),
  message('assistant', [text(answer)])
]

const topic = (id: string, name: string, lastActivityAt = '2026-01-01T00:00:00.000Z') => ({ id, name, lastActivityAt })

function run(
  {
    source,
    target = [],
    protectedIds = []
  }: {
    source: ReturnType<typeof topic>[]
    target?: ReturnType<typeof topic>[]
    protectedIds?: string[]
  },
  messagesById: Record<string, Message[]>
) {
  const loadMessages = vi.fn(async (id: string) => messagesById[id] ?? [])
  const result = findDuplicateTopicIds({
    sourceTopics: source,
    targetTopics: target,
    protectedIds: new Set(protectedIds),
    loadMessages
  })
  return { result, loadMessages }
}

describe('topicContentSignature', () => {
  it('ignores message ids and step markers but not text', () => {
    const a = [message('user', [text('hi')], 'a1'), message('assistant', [{ type: 'step-start' }, text('yo')], 'a2')]
    const b = [message('user', [text('hi')], 'b1'), message('assistant', [text('yo')], 'b2')]
    const c = [message('user', [text('hi')], 'c1'), message('assistant', [text('yo!')], 'c2')]

    expect(topicContentSignature(a)).toBe(topicContentSignature(b))
    expect(topicContentSignature(a)).not.toBe(topicContentSignature(c))
  })

  it('tells roles apart and treats a conversation without content as unknown', () => {
    expect(topicContentSignature([message('user', [text('x')])])).not.toBe(
      topicContentSignature([message('assistant', [text('x')])])
    )
    expect(topicContentSignature([])).toBeUndefined()
    expect(topicContentSignature([message('assistant', [{ type: 'step-start' }])])).toBeUndefined()
  })
})

describe('findDuplicateTopicIds', () => {
  it('trashes the source copy of a target topic with the same title and content', async () => {
    const { result } = run(
      { source: [topic('s1', ' Trip plan ')], target: [topic('t1', 'Trip plan')] },
      { s1: chat('Plan Rome', 'Day 1...'), t1: chat('Plan Rome', 'Day 1...') }
    )

    expect(await result).toEqual(['s1'])
  })

  it('keeps topics that share a title but differ in content, and vice versa', async () => {
    const { result } = run(
      {
        source: [topic('s1', 'Trip plan'), topic('s2', 'Other title')],
        target: [topic('t1', 'Trip plan')]
      },
      {
        s1: chat('Plan Rome', 'Day 1...'),
        t1: chat('Plan Rome', 'Day 1, revised'),
        s2: chat('Plan Rome', 'Day 1, revised')
      }
    )

    expect(await result).toEqual([])
  })

  it('keeps the most recently active source copy when the duplicates are all in the source', async () => {
    const { result } = run(
      {
        source: [
          topic('old', 'Notes', '2026-01-01T00:00:00.000Z'),
          topic('new', 'Notes', '2026-03-01T00:00:00.000Z'),
          topic('mid', 'Notes', '2026-02-01T00:00:00.000Z')
        ]
      },
      { old: chat('a', 'b'), new: chat('a', 'b'), mid: chat('a', 'b') }
    )

    expect((await result).sort()).toEqual(['mid', 'old'])
  })

  it('never trashes protected topics and prefers them as the kept copy', async () => {
    const { result } = run(
      {
        source: [
          topic('pinned', 'Notes', '2026-01-01T00:00:00.000Z'),
          topic('recent', 'Notes', '2026-03-01T00:00:00.000Z')
        ],
        protectedIds: ['pinned']
      },
      { pinned: chat('a', 'b'), recent: chat('a', 'b') }
    )
    expect(await result).toEqual(['recent'])

    const onlyProtected = run(
      { source: [topic('s1', 'Notes')], target: [topic('t1', 'Notes')], protectedIds: ['s1'] },
      { s1: chat('a', 'b'), t1: chat('a', 'b') }
    )
    expect(await onlyProtected.result).toEqual([])
    expect(onlyProtected.loadMessages).not.toHaveBeenCalled()
  })

  it('never treats empty conversations as duplicates', async () => {
    const { result } = run({ source: [topic('s1', '')], target: [topic('t1', '')] }, {})

    expect(await result).toEqual([])
  })

  it('loads messages only for topics whose titles collide', async () => {
    const { result, loadMessages } = run(
      { source: [topic('s1', 'Alpha'), topic('s2', 'Beta')], target: [topic('t1', 'Gamma'), topic('t2', 'Alpha')] },
      { s1: chat('a', 'b'), t2: chat('a', 'b') }
    )

    expect(await result).toEqual(['s1'])
    expect(loadMessages.mock.calls.map(([id]) => id).sort()).toEqual(['s1', 't2'])
  })
})
