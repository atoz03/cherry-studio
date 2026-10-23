import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { query, type McpSdkServerConfigWithInstance, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { serveMcpTestServer } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveMountedMcpServers } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { PromptBuilder } from '@main/ai/agents/prompt'
import { createAgentMemoryServer } from '@main/ai/mcp/servers/agentMemory'

import { createClaudeCodeIdentityHooks } from './claudeCode/identityHooks'

type Request = { system: unknown; messages: unknown; model: string; stream?: boolean }

describe('Identity delivered by the native SDKs', () => {
  let root: string
  let server: Server
  let baseUrl: string
  let requests: Request[]
  let abortController: AbortController
  let timeout: ReturnType<typeof setTimeout>

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-identity-sdk-'))
    await mkdir(path.join(root, 'memory'))
    requests = []
    abortController = new AbortController()
    timeout = setTimeout(() => abortController.abort(), 20_000)
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk)
      if (req.url?.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":100}')
        return
      }
      if (!req.url?.includes('/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Request
      requests.push(body)
      const message = {
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 1 }
      }
      // Summaries deliberately contain no identity: only the harness can restore it after compaction.
      const text = 'OK. No identity is retained in this response or summary.'
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        { type: 'message_start', message },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { input_tokens: 100, output_tokens: 1 }
        },
        { type: 'message_stop' }
      ])
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    clearTimeout(timeout)
    abortController.abort()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })

  async function writeIdentity(revision: string) {
    await writeFile(path.join(root, 'SOUL.md'), `IDENTITY_SOUL_${revision}`)
    await writeFile(path.join(root, 'USER.md'), `IDENTITY_USER_${revision}`)
    await writeFile(path.join(root, 'memory', 'FACT.md'), `IDENTITY_FACT_${revision}`)
  }

  const lastMessages = () => JSON.stringify(requests.at(-1)?.messages)
  const lastSystem = () => JSON.stringify(requests.at(-1)?.system)

  it.each([false, true])('delivers MCP memory instructions only when enabled (disabled=%s)', async (disabled) => {
    await writeIdentity('MEMORY_GATE')
    const mounted = resolveMountedMcpServers(
      { type: 'claude-code', configuration: {}, disabledTools: disabled ? ['mcp__agent-memory__memory'] : [] },
      { channelLinked: false }
    )
    const { context } = await new PromptBuilder().buildPromptParts(root, { bootstrap_completed: true })
    const stream = query({
      prompt: 'Say hello.',
      options: {
        cwd: root,
        abortController,
        env: {
          PATH: process.env.PATH,
          ANTHROPIC_API_KEY: 'local-test-key',
          ANTHROPIC_BASE_URL: baseUrl,
          CLAUDE_CONFIG_DIR: path.join(root, 'config'),
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_TELEMETRY: '1',
          DISABLE_ERROR_REPORTING: '1'
        },
        model: 'claude-sonnet-4-5-20250929',
        allowedTools: ['mcp__agent-memory__memory'],
        mcpServers: mounted.has('agent-memory')
          ? {
              'agent-memory': {
                type: 'sdk',
                name: 'agent-memory',
                instance: {
                  connect: serveMcpTestServer(() =>
                    createAgentMemoryServer({ agentId: 'fixture', agentDataPath: root })
                  )
                } as unknown as McpSdkServerConfigWithInstance['instance']
              }
            }
          : {},
        strictMcpConfig: true,
        settingSources: [],
        settings: { autoMemoryEnabled: false },
        hooks: createClaudeCodeIdentityHooks(root),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: context, snapshot: false }
      }
    })
    try {
      for await (const message of stream) {
        if (!disabled && message.type === 'system' && message.subtype === 'init') {
          expect(message.mcp_servers).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: 'agent-memory', status: 'connected' })])
          )
        }
        if (message.type === 'result') expect(message.is_error).toBe(false)
      }
      expect(requests.length).toBeGreaterThan(0)
      expect(lastMessages()).toContain('IDENTITY_FACT_MEMORY_GATE')
      const guide = 'Use the memory tool for persistent memory'
      const requestContext = lastSystem() + lastMessages()
      if (disabled) expect(requestContext).not.toContain(guide)
      else expect(requestContext).toContain(guide)
    } finally {
      stream.close()
    }
  })

  it('refreshes a live Claude query, rehydrates after compaction, and reloads on resume', async () => {
    const { context } = await new PromptBuilder().buildPromptParts(root, { bootstrap_completed: true })
    const options = {
      cwd: root,
      abortController,
      env: {
        PATH: process.env.PATH,
        ANTHROPIC_API_KEY: 'local-test-key',
        ANTHROPIC_BASE_URL: baseUrl,
        CLAUDE_CONFIG_DIR: path.join(root, 'config'),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_TELEMETRY: '1',
        DISABLE_ERROR_REPORTING: '1'
      },
      model: 'claude-sonnet-4-5-20250929',
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      settings: { autoMemoryEnabled: false },
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: context, snapshot: false }
    }
    await writeIdentity('A')
    const turns = ['first', 'changed', 'unchanged', '/compact', 'after compact']
    let done = Promise.withResolvers<void>()
    const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
      for (const [index, text] of turns.entries()) {
        if (index === 1) await writeIdentity('B')
        const completion = done.promise
        yield { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: text } }
        await completion
      }
    })()
    const stream = query({ prompt, options: { ...options, hooks: createClaudeCodeIdentityHooks(root) } })
    const contexts: string[] = []
    let sessionId: string | undefined
    try {
      for await (const message of stream) {
        sessionId = message.session_id
        if (message.type !== 'result') continue
        expect(message.is_error).toBe(false)
        contexts.push(lastMessages())
        const previous = done
        done = Promise.withResolvers<void>()
        previous.resolve()
      }
    } finally {
      done.resolve()
      stream.close()
    }
    expect(contexts).toHaveLength(turns.length)
    for (const kind of ['SOUL', 'USER', 'FACT']) {
      expect(contexts[0]).toContain(`IDENTITY_${kind}_A`)
      expect(contexts[1]).toContain(`IDENTITY_${kind}_B`)
      expect(contexts[2].match(new RegExp(`IDENTITY_${kind}_B`, 'g'))).toHaveLength(1)
      expect(contexts[4]).toContain(`IDENTITY_${kind}_B`)
      expect(contexts[4]).not.toContain(`IDENTITY_${kind}_A`)
    }

    await writeIdentity('C')
    expect(sessionId).toBeDefined()
    const resumed = query({
      prompt: 'after resume',
      options: { ...options, resume: sessionId, hooks: createClaudeCodeIdentityHooks(root) }
    })
    try {
      for await (const message of resumed) {
        if (message.type === 'result') expect(message.is_error).toBe(false)
      }
    } finally {
      resumed.close()
    }
    expect(lastMessages()).toContain('IDENTITY_SOUL_C')
    expect(lastMessages()).toContain('IDENTITY_USER_C')
    expect(lastMessages()).toContain('IDENTITY_FACT_C')
  }, 30_000)
})
