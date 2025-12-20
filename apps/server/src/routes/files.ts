import type { Request, Response } from 'express'
import express from 'express'

import { fileStore } from '../services/FileStore'

const router = express.Router()

router.post('/', async (req: Request, res: Response) => {
  const name = String(req.headers['x-file-name'] || 'upload')
  const originName = String(req.headers['x-file-origin-name'] || name)
  const id = req.headers['x-file-id'] ? String(req.headers['x-file-id']) : undefined
  const ext = req.headers['x-file-ext'] ? String(req.headers['x-file-ext']) : undefined
  const mime = req.headers['content-type'] ? String(req.headers['content-type']) : undefined
  const sizeHeader = req.headers['x-file-size']
  const size = sizeHeader ? Number(sizeHeader) : undefined

  try {
    const meta = await fileStore.saveFromStream(req, { id, name, originName, ext, mime, size })
    res.json(meta)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Upload failed' })
  }
})

router.get('/:id/base64', async (req: Request, res: Response) => {
  const result = await fileStore.readBase64(req.params.id)
  if (!result) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  res.json(result)
})

router.get('/:id/text', async (req: Request, res: Response) => {
  const content = await fileStore.readText(req.params.id)
  if (content === null) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  res.type('text/plain').send(content)
})

router.get('/:id', async (req: Request, res: Response) => {
  const entry = fileStore.getFileByKey(req.params.id)
  if (!entry) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  res.sendFile(entry.filePath)
})

router.delete('/:id', async (req: Request, res: Response) => {
  const ok = await fileStore.deleteFile(req.params.id)
  res.json({ success: ok })
})

router.delete('/', async (_req: Request, res: Response) => {
  await fileStore.clearAll()
  res.json({ success: true })
})

export default router
