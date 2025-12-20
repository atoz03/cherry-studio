import fs from 'node:fs'
import path from 'node:path'

import type { KnowledgeBaseParams, KnowledgeItem, KnowledgeSearchResult } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { getDataPath } from '../utils/paths'
import { fileStore } from './FileStore'

type KnowledgeChunk = {
  id: string
  baseId: string
  itemId: string
  pageContent: string
  metadata: Record<string, any>
}

type KnowledgeSnapshot = {
  bases: KnowledgeBaseParams[]
  items: KnowledgeItem[]
  chunks: KnowledgeChunk[]
}

const DEFAULT_CHUNK_SIZE = 1000
const DEFAULT_CHUNK_OVERLAP = 200

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  if (!text) return []
  const size = Math.max(1, chunkSize)
  const step = Math.max(1, size - Math.max(0, overlap))
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + size))
    if (i + size >= text.length) break
  }
  return chunks
}

export class KnowledgeStore {
  private baseMap = new Map<string, KnowledgeBaseParams>()
  private itemMap = new Map<string, KnowledgeItem>()
  private chunks: KnowledgeChunk[] = []
  private storagePath: string

  constructor() {
    const dataDir = getDataPath()
    this.storagePath = path.join(dataDir, 'knowledge.json')
    this.load()
  }

  private load() {
    if (!fs.existsSync(this.storagePath)) return
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf-8')
      if (!raw) return
      const snapshot = JSON.parse(raw) as KnowledgeSnapshot
      snapshot.bases.forEach((base) => this.baseMap.set(base.id, base))
      snapshot.items.forEach((item) => this.itemMap.set(item.id, item))
      this.chunks = snapshot.chunks || []
    } catch {
      this.baseMap.clear()
      this.itemMap.clear()
      this.chunks = []
    }
  }

  private persist() {
    const snapshot: KnowledgeSnapshot = {
      bases: Array.from(this.baseMap.values()),
      items: Array.from(this.itemMap.values()),
      chunks: this.chunks
    }
    fs.writeFileSync(this.storagePath, JSON.stringify(snapshot, null, 2))
  }

  create(base: KnowledgeBaseParams) {
    this.baseMap.set(base.id, base)
    this.persist()
    return base
  }

  reset(base: KnowledgeBaseParams) {
    this.itemMap.forEach((item) => {
      if (item.baseId === base.id) {
        this.itemMap.delete(item.id)
      }
    })
    this.chunks = this.chunks.filter((chunk) => chunk.baseId !== base.id)
    this.persist()
  }

  delete(baseId: string) {
    this.baseMap.delete(baseId)
    this.reset({ id: baseId } as KnowledgeBaseParams)
    this.persist()
  }

  private async resolveItemText(item: KnowledgeItem): Promise<string[]> {
    if (typeof item.content === 'string') {
      if (item.type === 'url' || item.type === 'sitemap') {
        try {
          const response = await fetch(item.content)
          if (response.ok) {
            return [await response.text()]
          }
        } catch {
          return []
        }
      }
      return [item.content]
    }

    if (Array.isArray(item.content)) {
      const entries = await Promise.all(
        item.content.map(async (file) => {
          const content = await fileStore.readText(`${file.id}${file.ext}`)
          return content || ''
        })
      )
      return entries.filter((entry) => entry)
    }

    const file = item.content
    if (file && typeof file === 'object' && 'id' in file) {
      const content = await fileStore.readText(`${file.id}${file.ext}`)
      return content ? [content] : []
    }

    return []
  }

  async add(base: KnowledgeBaseParams, item: KnowledgeItem) {
    this.baseMap.set(base.id, base)
    this.itemMap.set(item.id, { ...item, baseId: base.id })

    const chunkSize = base.chunkSize || DEFAULT_CHUNK_SIZE
    const overlap = base.chunkOverlap || DEFAULT_CHUNK_OVERLAP
    const contents = await this.resolveItemText(item)
    let addedEntries = 0

    contents.forEach((content) => {
      const chunks = chunkText(content, chunkSize, overlap)
      chunks.forEach((chunk) => {
        this.chunks.push({
          id: uuidv4(),
          baseId: base.id,
          itemId: item.id,
          pageContent: chunk,
          metadata: {
            itemId: item.id,
            baseId: base.id,
            type: item.type
          }
        })
        addedEntries += 1
      })
    })

    this.persist()
    return {
      entriesAdded: addedEntries,
      uniqueId: item.id,
      uniqueIds: [item.id],
      loaderType: item.type,
      status: 'completed'
    }
  }

  remove(base: KnowledgeBaseParams, uniqueIds: string[]) {
    const removeSet = new Set(uniqueIds)
    this.itemMap.forEach((item, id) => {
      if (item.baseId === base.id && removeSet.has(id)) {
        this.itemMap.delete(id)
      }
    })
    this.chunks = this.chunks.filter((chunk) => !(chunk.baseId === base.id && removeSet.has(chunk.itemId)))
    this.persist()
    return { success: true }
  }

  search(base: KnowledgeBaseParams, query: string): KnowledgeSearchResult[] {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return []

    const results = this.chunks
      .filter((chunk) => chunk.baseId === base.id)
      .map((chunk) => {
        const content = chunk.pageContent.toLowerCase()
        const count = content.split(keyword).length - 1
        if (count <= 0) return null
        return {
          pageContent: chunk.pageContent,
          score: count,
          metadata: chunk.metadata
        } satisfies KnowledgeSearchResult
      })
      .filter((item): item is KnowledgeSearchResult => item !== null)

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, 20)
  }

  checkQuota(): number {
    return 9999
  }
}

export const knowledgeStore = new KnowledgeStore()
