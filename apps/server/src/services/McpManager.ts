import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions
} from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { MCPCallToolResponse, MCPPrompt, MCPResource, MCPServer, MCPTool } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { ServerLogBuffer } from './ServerLogBuffer'

type CallToolArgs = { server: MCPServer; name: string; args: any; callId?: string }

const DEFAULT_TIMEOUT_MS = 60_000

function getServerKey(server: MCPServer): string {
  return JSON.stringify({
    baseUrl: server.baseUrl,
    command: server.command,
    args: Array.isArray(server.args) ? server.args : [],
    env: server.env,
    id: server.id
  })
}

function buildHeaders(server: MCPServer): Record<string, string> {
  return {
    ...server.headers
  }
}

export class McpManager {
  private clients: Map<string, Client> = new Map()
  private pendingClients: Map<string, Promise<Client>> = new Map()
  private activeToolCalls: Map<string, AbortController> = new Map()
  private serverLogs = new ServerLogBuffer(200)

  private async initClient(server: MCPServer): Promise<Client> {
    const serverKey = getServerKey(server)
    const cached = this.clients.get(serverKey)
    if (cached) return cached

    const pending = this.pendingClients.get(serverKey)
    if (pending) return pending

    const initPromise = (async () => {
      const client = new Client(
        { name: 'Cherry Studio Web', version: process.env.npm_package_version || '0.0.0' },
        { capabilities: {} }
      )

      const transport = await this.createTransport(server)
      await client.connect(transport)
      this.clients.set(serverKey, client)
      this.pendingClients.delete(serverKey)
      return client
    })()

    this.pendingClients.set(serverKey, initPromise)
    return initPromise
  }

  private async createTransport(
    server: MCPServer
  ): Promise<StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport> {
    if (server.baseUrl) {
      const headers = buildHeaders(server)
      if (server.type === 'sse') {
        const options: SSEClientTransportOptions = {
          eventSourceInit: {
            fetch: async (url, init) => fetch(typeof url === 'string' ? url : url.toString(), init)
          },
          requestInit: {
            headers
          }
        }
        return new SSEClientTransport(new URL(server.baseUrl), options)
      }

      const options: StreamableHTTPClientTransportOptions = {
        fetch: async (url, init) => fetch(typeof url === 'string' ? url : url.toString(), init),
        requestInit: {
          headers
        }
      }
      return new StreamableHTTPClientTransport(new URL(server.baseUrl), options)
    }

    if (server.command) {
      const params: StdioServerParameters = {
        command: server.command,
        args: server.args || [],
        env: server.env || process.env
      }
      return new StdioClientTransport(params)
    }

    throw new Error('MCP server configuration missing baseUrl or command')
  }

  private log(server: MCPServer, level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) {
    this.serverLogs.append(getServerKey(server), {
      timestamp: Date.now(),
      level,
      message,
      data
    })
  }

  async listTools(server: MCPServer): Promise<MCPTool[]> {
    const client = await this.initClient(server)
    this.log(server, 'debug', 'listTools')
    const result = await client.listTools()
    return result.tools
  }

  async callTool({ server, name, args, callId }: CallToolArgs): Promise<MCPCallToolResponse> {
    const toolCallId = callId || uuidv4()
    const abortController = new AbortController()
    this.activeToolCalls.set(toolCallId, abortController)

    try {
      const client = await this.initClient(server)
      let parsedArgs: any = args
      if (typeof args === 'string') {
        try {
          parsedArgs = args ? JSON.parse(args) : {}
        } catch {
          parsedArgs = {}
        }
      }
      this.log(server, 'info', `callTool:${name}`, { callId: toolCallId })
      const result = await client.callTool({ name, arguments: parsedArgs }, undefined, {
        timeout: server.timeout ? server.timeout * 1000 : DEFAULT_TIMEOUT_MS,
        signal: abortController.signal,
        onprogress: (progress) => {
          this.log(server, 'debug', `progress:${name}`, {
            callId: toolCallId,
            progress: progress.progress,
            total: progress.total
          })
        }
      })
      return result as MCPCallToolResponse
    } finally {
      this.activeToolCalls.delete(toolCallId)
    }
  }

  async listPrompts(server: MCPServer): Promise<MCPPrompt[]> {
    const client = await this.initClient(server)
    const result = await client.listPrompts()
    return result.prompts
  }

  async getPrompt(server: MCPServer, name: string, args?: Record<string, any>) {
    const client = await this.initClient(server)
    return client.getPrompt({ name, arguments: args || {} })
  }

  async listResources(server: MCPServer): Promise<MCPResource[]> {
    const client = await this.initClient(server)
    const result = await client.listResources()
    return result.resources
  }

  async getResource(server: MCPServer, uri: string) {
    const client = await this.initClient(server)
    return client.getResource({ uri })
  }

  abortTool(callId: string): boolean {
    const controller = this.activeToolCalls.get(callId)
    if (!controller) return false
    controller.abort()
    this.activeToolCalls.delete(callId)
    return true
  }

  async getServerVersion(server: MCPServer): Promise<string | null> {
    const client = await this.initClient(server)
    const info = client.getServerVersion()
    return info?.version || null
  }

  getServerLogs(server: MCPServer) {
    return this.serverLogs.get(getServerKey(server))
  }
}

export const mcpManager = new McpManager()
