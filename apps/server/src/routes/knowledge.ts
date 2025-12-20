import type { KnowledgeBaseParams, KnowledgeItem, KnowledgeSearchResult } from '@types'
import type { Request, Response } from 'express'
import express from 'express'

import { knowledgeStore } from '../services/KnowledgeStore'

const router = express.Router()

router.post('/create', (req: Request, res: Response) => {
  const base = req.body as KnowledgeBaseParams
  if (!base?.id) {
    res.status(400).json({ error: 'Missing base id' })
    return
  }
  knowledgeStore.create(base)
  res.json({ success: true })
})

router.post('/reset', (req: Request, res: Response) => {
  const base = req.body as KnowledgeBaseParams
  if (!base?.id) {
    res.status(400).json({ error: 'Missing base id' })
    return
  }
  knowledgeStore.reset(base)
  res.json({ success: true })
})

router.post('/delete', (req: Request, res: Response) => {
  const { id } = req.body as { id?: string }
  if (!id) {
    res.status(400).json({ error: 'Missing base id' })
    return
  }
  knowledgeStore.delete(id)
  res.json({ success: true })
})

router.post('/add', async (req: Request, res: Response) => {
  const { base, item } = req.body as { base?: KnowledgeBaseParams; item?: KnowledgeItem }
  if (!base || !item) {
    res.status(400).json({ error: 'Missing base or item' })
    return
  }
  try {
    const result = await knowledgeStore.add(base, item)
    res.json(result)
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to add item' })
  }
})

router.post('/remove', (req: Request, res: Response) => {
  const { base, uniqueId, uniqueIds } = req.body as {
    base?: KnowledgeBaseParams
    uniqueId?: string
    uniqueIds?: string[]
  }
  if (!base) {
    res.status(400).json({ error: 'Missing base' })
    return
  }
  const ids = uniqueIds || (uniqueId ? [uniqueId] : [])
  const result = knowledgeStore.remove(base, ids)
  res.json(result)
})

router.post('/search', (req: Request, res: Response) => {
  const { search, base } = req.body as { search?: string; base?: KnowledgeBaseParams }
  if (!search || !base) {
    res.status(400).json({ error: 'Missing search or base' })
    return
  }
  const results = knowledgeStore.search(base, search)
  res.json(results)
})

router.post('/rerank', (req: Request, res: Response) => {
  const { results } = req.body as { results?: KnowledgeSearchResult[] }
  res.json(results || [])
})

router.post('/check-quota', (_req: Request, res: Response) => {
  res.json(knowledgeStore.checkQuota())
})

export default router
