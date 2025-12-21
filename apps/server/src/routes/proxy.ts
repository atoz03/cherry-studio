import { Readable } from 'node:stream'

import type { Request, Response } from 'express'
import express from 'express'

const router = express.Router()

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade'
])

router.all('/proxy', async (req: Request, res: Response) => {
  const targetUrl = req.headers['x-cherry-proxy-url']
  if (!targetUrl || typeof targetUrl !== 'string') {
    res.status(400).json({ error: 'Missing x-cherry-proxy-url header' })
    return
  }

  let resolvedUrl: URL | null = null
  try {
    resolvedUrl = new URL(targetUrl)
  } catch {
    res.status(400).json({ error: 'Invalid x-cherry-proxy-url header', targetUrl })
    return
  }

  const controller = new AbortController()
  req.on('aborted', () => controller.abort())
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort()
    }
  })

  const headers: Record<string, string> = {}
  Object.entries(req.headers).forEach(([key, value]) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return
    if (key.toLowerCase() === 'host') return
    if (key.toLowerCase() === 'x-cherry-proxy-url') return
    if (typeof value === 'string') {
      headers[key] = value
      return
    }
    if (Array.isArray(value)) {
      headers[key] = value.join(',')
    }
  })

  const method = req.method || 'GET'
  const hasBody = !['GET', 'HEAD'].includes(method.toUpperCase())
  const hasParsedBody = req.body !== undefined && req.body !== null && Object.keys(req.body || {}).length > 0
  const body = hasBody ? (hasParsedBody ? JSON.stringify(req.body) : req) : undefined

  try {
    const response = await fetch(resolvedUrl, {
      method,
      headers,
      body,
      duplex: hasBody && !hasParsedBody ? 'half' : undefined,
      signal: controller.signal
    })

    res.status(response.status)
    response.headers.forEach((value, key) => {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return
      res.setHeader(key, value)
    })

    if (!response.body) {
      res.end()
      return
    }

    const bodyStream = Readable.fromWeb(response.body)
    bodyStream.pipe(res)
  } catch (error: any) {
    res.status(502).json({
      error: error?.message || 'Proxy request failed',
      targetUrl: resolvedUrl?.toString() || targetUrl
    })
  }
})

export default router
