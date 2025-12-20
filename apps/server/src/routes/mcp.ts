import type { MCPServer } from '@types'
import type { Request, Response } from 'express'
import express from 'express'

import { mcpManager } from '../services/McpManager'

const router = express.Router()

router.post('/list-tools', async (req: Request, res: Response) => {
  const server = req.body?.server as MCPServer | undefined
  if (!server) {
    res.status(400).json({ error: 'Missing server' })
    return
  }
  try {
    const tools = await mcpManager.listTools(server)
    res.json(tools)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list tools' })
  }
})

router.post('/call-tool', async (req: Request, res: Response) => {
  const { server, name, args, callId } = req.body || {}
  if (!server || !name) {
    res.status(400).json({ error: 'Missing server or tool name' })
    return
  }
  try {
    const result = await mcpManager.callTool({ server, name, args, callId })
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to call tool' })
  }
})

router.post('/list-prompts', async (req: Request, res: Response) => {
  const server = req.body?.server as MCPServer | undefined
  if (!server) {
    res.status(400).json({ error: 'Missing server' })
    return
  }
  try {
    const prompts = await mcpManager.listPrompts(server)
    res.json(prompts)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list prompts' })
  }
})

router.post('/get-prompt', async (req: Request, res: Response) => {
  const { server, name, args } = req.body || {}
  if (!server || !name) {
    res.status(400).json({ error: 'Missing server or prompt name' })
    return
  }
  try {
    const prompt = await mcpManager.getPrompt(server, name, args)
    res.json(prompt)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get prompt' })
  }
})

router.post('/list-resources', async (req: Request, res: Response) => {
  const server = req.body?.server as MCPServer | undefined
  if (!server) {
    res.status(400).json({ error: 'Missing server' })
    return
  }
  try {
    const resources = await mcpManager.listResources(server)
    res.json(resources)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list resources' })
  }
})

router.post('/get-resource', async (req: Request, res: Response) => {
  const { server, uri } = req.body || {}
  if (!server || !uri) {
    res.status(400).json({ error: 'Missing server or resource uri' })
    return
  }
  try {
    const resource = await mcpManager.getResource(server, uri)
    res.json(resource)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get resource' })
  }
})

router.post('/abort', async (req: Request, res: Response) => {
  const callId = req.body?.callId as string | undefined
  if (!callId) {
    res.status(400).json({ error: 'Missing callId' })
    return
  }
  const ok = mcpManager.abortTool(callId)
  res.json({ success: ok })
})

router.post('/server-version', async (req: Request, res: Response) => {
  const server = req.body?.server as MCPServer | undefined
  if (!server) {
    res.status(400).json({ error: 'Missing server' })
    return
  }
  try {
    const version = await mcpManager.getServerVersion(server)
    res.json({ version })
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get server version' })
  }
})

router.post('/server-logs', async (req: Request, res: Response) => {
  const server = req.body?.server as MCPServer | undefined
  if (!server) {
    res.status(400).json({ error: 'Missing server' })
    return
  }
  res.json(mcpManager.getServerLogs(server))
})

export default router
