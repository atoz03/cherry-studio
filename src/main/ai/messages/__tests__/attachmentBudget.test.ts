import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, describe, expect, it } from 'vitest'

import { makeModel } from '@main/ai/__tests__/fixtures/model'
import { makeProvider } from '@main/ai/__tests__/fixtures/provider'
import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { allocateAttachmentBudget, allocateInlineCaps, resolveAttachmentBudget } from '../attachmentBudget'
import { ALL_MEDIA } from '../messageCapabilities'

/** One token per character, so allocations read directly as character counts. */
const charTokenizer = { id: 'chars', count: (text: string) => text.length }
const budgetOf = (tokens: number) => ({ tokens, tokenizer: charTokenizer })

describe('allocateAttachmentBudget', () => {
  // The defect this replaces: the cap was `max(READ_FILE_PAGE_SIZE, share)` per
  // file, so N attachments inlined N × 8000 no matter how small the share was.
  it('never exceeds the total, however many files ask for a share', () => {
    const sizes = new Array(1_000).fill(500_000)
    const allocated = allocateAttachmentBudget(sizes, 100_000)

    expect(sum(allocated)).toBeLessThanOrEqual(100_000)
    expect(sum(allocated)).toBeGreaterThan(0)
    expect(1_000 * READ_FILE_PAGE_SIZE).toBeGreaterThan(100_000) // the old floor would have blown it
  })

  // An equal split would truncate the big file at half the pool while the small
  // one leaves its half unused.
  it('serves small files whole and gives the rest to the large ones', () => {
    expect(allocateAttachmentBudget([10, 1_000], 100)).toEqual([10, 90])
  })

  it('leaves the pool alone when everything fits', () => {
    expect(allocateAttachmentBudget([10, 20], 1_000)).toEqual([10, 20])
  })

  it('allocates nothing rather than throwing on an exhausted or absent pool', () => {
    expect(allocateAttachmentBudget([100, 200], 0)).toEqual([0, 0])
    expect(allocateAttachmentBudget([100], -5)).toEqual([0])
    expect(allocateAttachmentBudget([], 100)).toEqual([])
  })
})

describe('allocateInlineCaps', () => {
  it('caps each body within the shared pool', () => {
    const caps = allocateInlineCaps(['a'.repeat(50), 'b'.repeat(50)], budgetOf(60))

    expect(caps).toEqual([30, 30])
  })

  // A cap in tokens has to become a cut point in characters, and the two differ
  // per script — CJK runs ~1 char/token where English runs ~4.
  it('converts a token cap using each body own measured ratio', () => {
    const twoCharsPerToken = { id: 'halves', count: (text: string) => Math.ceil(text.length / 2) }
    const [cap] = allocateInlineCaps(['x'.repeat(100)], { tokens: 10, tokenizer: twoCharsPerToken })

    expect(cap).toBe(20)
  })

  // Density is not uniform inside one attachment. Scaling by the body's average
  // chars-per-token overshot on a dense head: a 100-CJK/400-ASCII body averages
  // 2.5 chars/token, so a 50-token cap kept 125 chars — really 107 tokens. The
  // pool's ceiling then failed to hold for mixed-language and code attachments.
  it('cuts by measured prefix cost, not by the body average density', () => {
    const mixed = {
      id: 'mixed',
      count: (t: string) => Math.ceil([...t].reduce((n, c) => n + (c > '\u007f' ? 1 : 0.25), 0))
    }
    const body = '一'.repeat(100) + 'a'.repeat(400)

    const [cap] = allocateInlineCaps([body], { tokens: 50, tokenizer: mixed })

    expect(mixed.count(body.slice(0, cap))).toBeLessThanOrEqual(50)
  })

  // The property the whole pool exists for: whatever the scripts involved, the
  // sum of what is actually inlined stays inside the budget.
  it('keeps the total inlined cost within the pool for mixed-density bodies', () => {
    const mixed = {
      id: 'mixed',
      count: (t: string) => Math.ceil([...t].reduce((n, c) => n + (c > '\u007f' ? 1 : 0.25), 0))
    }
    const bodies = ['一'.repeat(200) + 'b'.repeat(800), 'c'.repeat(2_000), '文'.repeat(300)]
    const pool = 120

    const caps = allocateInlineCaps(bodies, { tokens: pool, tokenizer: mixed })
    const spent = bodies.reduce((sum, body, i) => sum + mixed.count(body.slice(0, caps[i])), 0)

    expect(spent).toBeLessThanOrEqual(pool)
  })

  it('does not cut a body that fits', () => {
    expect(allocateInlineCaps(['short'], budgetOf(1_000))).toEqual([5])
  })

  it('survives an empty body without dividing by zero', () => {
    expect(allocateInlineCaps([''], budgetOf(0))).toEqual([0])
  })
})

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

describe('resolveAttachmentBudget tokenizer', () => {
  const resolveForOpenAi = () =>
    resolveAttachmentBudget({
      provider: makeProvider({
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' } }
      }),
      model: makeModel({ contextWindow: 128_000 }),
      system: 'You are helpful.',
      tools: undefined,
      maxOutputTokens: undefined,
      messages: [],
      mediaCapabilities: ALL_MEDIA
    })

  afterEach(() => MockMainPreferenceServiceUtils.resetMocks())

  // Releasing idle runtimes must not load the GPT tokenizer, which then stays for the session.
  it('estimates instead of loading the BPE tokenizer while idle runtimes are released', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.memory.release_idle_runtimes', true)

    expect((await resolveForOpenAi())?.tokenizer.id).toBe('tokenx')
  })

  it('counts with the BPE tokenizer when the user keeps runtimes loaded', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.memory.release_idle_runtimes', false)

    expect((await resolveForOpenAi())?.tokenizer.id).toBe('gpt-tokenizer/o200k')
  })
})
