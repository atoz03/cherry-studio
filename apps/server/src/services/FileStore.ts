import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { audioExts, documentExts, imageExts, videoExts } from '@shared/config/constant'
import { v4 as uuidv4 } from 'uuid'

import { getDataPath } from '../utils/paths'

export type FileType = 'image' | 'video' | 'audio' | 'text' | 'document' | 'other'

export type FileMetadata = {
  id: string
  name: string
  origin_name: string
  path: string
  size: number
  ext: string
  type: FileType
  created_at: string
  count: number
}

type StoredFile = {
  meta: FileMetadata
  filePath: string
}

const FILE_INDEX_NAME = 'files.json'

function normalizeExt(value?: string): string {
  if (!value) return ''
  return value.startsWith('.') ? value.toLowerCase() : `.${value.toLowerCase()}`
}

function resolveFileType(ext: string, mime?: string): FileType {
  if (mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'
  if (documentExts.includes(ext)) return 'document'
  if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.csv') return 'text'
  return 'other'
}

export class FileStore {
  private filesDir: string
  private indexPath: string
  private fileMap: Map<string, StoredFile> = new Map()

  constructor() {
    const dataDir = getDataPath()
    this.filesDir = path.join(dataDir, 'files')
    this.indexPath = path.join(this.filesDir, FILE_INDEX_NAME)
    this.ensureDir()
    this.loadIndex()
  }

  private ensureDir() {
    if (!fs.existsSync(this.filesDir)) {
      fs.mkdirSync(this.filesDir, { recursive: true })
    }
  }

  private loadIndex() {
    if (!fs.existsSync(this.indexPath)) return
    const raw = fs.readFileSync(this.indexPath, 'utf-8')
    if (!raw) return
    try {
      const entries = JSON.parse(raw) as Array<FileMetadata>
      entries.forEach((meta) => {
        const filePath = path.join(this.filesDir, meta.name)
        this.fileMap.set(meta.id, { meta, filePath })
      })
    } catch {
      this.fileMap.clear()
    }
  }

  private persistIndex() {
    const payload = Array.from(this.fileMap.values()).map((entry) => entry.meta)
    fs.writeFileSync(this.indexPath, JSON.stringify(payload, null, 2))
  }

  async saveFromStream(
    stream: NodeJS.ReadableStream,
    options: { id?: string; name: string; originName?: string; size?: number; mime?: string; ext?: string }
  ): Promise<FileMetadata> {
    const id = options.id || uuidv4()
    const ext = normalizeExt(options.ext || path.extname(options.name))
    const fileName = `${id}${ext}`
    const filePath = path.join(this.filesDir, fileName)
    await pipeline(stream, fs.createWriteStream(filePath))
    const stats = fs.statSync(filePath)
    const meta: FileMetadata = {
      id,
      origin_name: options.originName || options.name,
      name: fileName,
      path: fileName,
      created_at: new Date().toISOString(),
      size: options.size || stats.size,
      ext,
      type: resolveFileType(ext, options.mime),
      count: 1
    }
    this.fileMap.set(id, { meta, filePath })
    this.persistIndex()
    return meta
  }

  getFileByKey(key: string): StoredFile | null {
    const ext = path.extname(key)
    const id = ext ? path.basename(key, ext) : key
    const entry = this.fileMap.get(id)
    if (!entry) return null
    return entry
  }

  async deleteFile(key: string): Promise<boolean> {
    const entry = this.getFileByKey(key)
    if (!entry) return false
    if (fs.existsSync(entry.filePath)) {
      fs.rmSync(entry.filePath)
    }
    this.fileMap.delete(entry.meta.id)
    this.persistIndex()
    return true
  }

  async clearAll(): Promise<void> {
    if (fs.existsSync(this.filesDir)) {
      fs.rmSync(this.filesDir, { recursive: true, force: true })
    }
    this.fileMap.clear()
    this.ensureDir()
    this.persistIndex()
  }

  async readText(key: string): Promise<string | null> {
    const entry = this.getFileByKey(key)
    if (!entry) return null
    return fs.readFileSync(entry.filePath, 'utf-8')
  }

  async readBase64(key: string): Promise<{ data: string; mime: string } | null> {
    const entry = this.getFileByKey(key)
    if (!entry) return null
    const buffer = fs.readFileSync(entry.filePath)
    const mime =
      entry.meta.type === 'image' ? `image/${entry.meta.ext.slice(1)}` : `application/${entry.meta.ext.slice(1)}`
    return { data: buffer.toString('base64'), mime }
  }

  async readBinary(key: string): Promise<{ data: Buffer; mime: string } | null> {
    const entry = this.getFileByKey(key)
    if (!entry) return null
    const buffer = fs.readFileSync(entry.filePath)
    const mime =
      entry.meta.type === 'image' ? `image/${entry.meta.ext.slice(1)}` : `application/${entry.meta.ext.slice(1)}`
    return { data: buffer, mime }
  }
}

export const fileStore = new FileStore()
