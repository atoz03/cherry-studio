import { readUIMessageStream } from 'ai'
import { describe, expect, it } from 'vitest'

import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'

import { type PiContentEvent, PI_TRANSPORT, PiStreamAdapter } from './piStreamAdapter'

function collect(events: PiContentEvent[]): CherryUIMessageChunk[] {
  const chunks: CherryUIMessageChunk[] = []
  const adapter = new PiStreamAdapter({ enqueue: (chunk) => chunks.push(chunk) })
  for (const event of events) adapter.handleEvent(event)
  return chunks
}

/** Feed the adapter chunks through the real AI SDK accumulator, as the host does. */
async function accumulate(chunks: CherryUIMessageChunk[]): Promise<CherryUIMessage> {
  const stream = new ReadableStream<CherryUIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  let last: CherryUIMessage | undefined
  for await (const snapshot of readUIMessageStream<CherryUIMessage>({ stream })) last = snapshot
  if (!last) throw new Error('no message produced')
  return last
}

const assistantEvent = (inner: Record<string, unknown>) =>
  ({ type: 'message_update', assistantMessageEvent: inner }) as PiContentEvent

describe('PiStreamAdapter', () => {
  it('maps a text + tool-call turn to the expected chunk sequence', () => {
    const chunks = collect([
      { type: 'message_start' },
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_delta', contentIndex: 0, delta: 'Hello' }),
      assistantEvent({ type: 'text_delta', contentIndex: 0, delta: ' world' }),
      assistantEvent({ type: 'text_end', contentIndex: 0 }),
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'bash',
        args: { command: 'ls' }
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: 'file.txt',
        isError: false
      },
      {
        type: 'turn_end',
        message: {
          role: 'assistant',
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 3, reasoning: 1, totalTokens: 0 }
        }
      }
    ])

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'message-metadata'
    ])

    const toolInput = chunks.find((chunk) => chunk.type === 'tool-input-available')
    expect(toolInput).toMatchObject({
      toolCallId: 't1',
      toolName: 'bash',
      input: { command: 'ls' },
      providerMetadata: { cherry: { transport: PI_TRANSPORT } }
    })

    const meta = chunks.find((chunk) => chunk.type === 'message-metadata')
    expect(meta).toMatchObject({
      messageMetadata: {
        totalTokens: 20,
        stats: {
          inputTokens: 15,
          outputTokens: 5,
          totalTokens: 20,
          outputTokenDetails: { reasoningTokens: 1 }
        }
      }
    })
  })

  it("shows a failed tool's message text, not pi's result wrapper", () => {
    const chunks = collect([
      { type: 'tool_execution_start', toolCallId: 'e1', toolName: 'edit', args: {} },
      {
        type: 'tool_execution_end',
        toolCallId: 'e1',
        toolName: 'edit',
        result: { content: [{ type: 'text', text: 'Could not find the exact text' }], details: {} },
        isError: true
      }
    ])
    const err = chunks.find((chunk) => chunk.type === 'tool-output-error')
    expect(err).toMatchObject({
      toolCallId: 'e1',
      errorText: 'Could not find the exact text',
      providerMetadata: { cherry: { transport: PI_TRANSPORT } }
    })
  })

  it('keeps content-part ids unique across multiple assistant messages in one loop', () => {
    const chunks = collect([
      { type: 'message_start' },
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_end', contentIndex: 0 }),
      { type: 'message_start' },
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_end', contentIndex: 0 })
    ])
    const ids = chunks.filter((chunk) => chunk.type === 'text-start').map((chunk) => (chunk as { id: string }).id)
    expect(new Set(ids).size).toBe(2)
  })

  it('sums token usage across the multiple turn_ends of one turn', async () => {
    const turnEnd = (usage: Record<string, number>): PiContentEvent => ({
      type: 'turn_end',
      message: { role: 'assistant', usage }
    })
    const chunks = collect([
      { type: 'agent_start' },
      turnEnd({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }),
      turnEnd({ input: 120, output: 80, cacheRead: 0, cacheWrite: 0 })
    ])
    // Each turn_end emits a running total; the last-wins chunk carries the whole turn.
    const metas = chunks.filter((chunk) => chunk.type === 'message-metadata')
    expect(metas.at(-1)).toMatchObject({
      messageMetadata: { totalTokens: 350, stats: { inputTokens: 220, outputTokens: 130, totalTokens: 350 } }
    })
    const message = await accumulate(chunks)
    expect(message.metadata).toMatchObject({
      totalTokens: 350,
      stats: { inputTokens: 220, outputTokens: 130, totalTokens: 350 }
    })
  })

  it('resets the token accumulator when a new turn starts (agent_start)', () => {
    const turnEnd = (usage: Record<string, number>): PiContentEvent => ({
      type: 'turn_end',
      message: { role: 'assistant', usage }
    })
    const chunks = collect([
      { type: 'agent_start' },
      turnEnd({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }),
      { type: 'agent_start' },
      turnEnd({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 })
    ])
    const metas = chunks.filter((chunk) => chunk.type === 'message-metadata')
    expect(metas.at(-1)).toMatchObject({
      messageMetadata: { totalTokens: 15, stats: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
    })
  })

  it('accumulates into a CherryUIMessage with text and tool parts', async () => {
    const chunks = collect([
      { type: 'message_start' },
      assistantEvent({ type: 'text_start', contentIndex: 0 }),
      assistantEvent({ type: 'text_delta', contentIndex: 0, delta: 'done' }),
      assistantEvent({ type: 'text_end', contentIndex: 0 }),
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'a' } },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'read',
        result: 'contents',
        isError: false
      }
    ])
    const message = await accumulate(chunks)
    const text = message.parts.find((part) => part.type === 'text')
    expect(text).toMatchObject({ text: 'done' })
    const tool = message.parts.find((part) => part.type === 'dynamic-tool')
    expect(tool).toMatchObject({ toolName: 'read', state: 'output-available', output: 'contents' })
  })

  it('stamps MCP tools with type mcp, name, and serverName from the tool name', () => {
    const chunks = collect([
      { type: 'tool_execution_start', toolCallId: 'm1', toolName: 'mcp__exa__search', args: {} },
      {
        type: 'tool_execution_end',
        toolCallId: 'm1',
        toolName: 'mcp__exa__search',
        result: { content: [{ type: 'text', text: 'results' }] },
        isError: false
      }
    ])
    const toolOutput = chunks.find((chunk) => chunk.type === 'tool-output-available')
    expect(toolOutput).toMatchObject({
      providerMetadata: {
        cherry: { transport: PI_TRANSPORT, tool: { type: 'mcp', name: 'search', serverName: 'exa' } }
      }
    })
  })
})
