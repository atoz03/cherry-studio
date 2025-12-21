import { loggerService } from '@logger'
import type { SpanContext } from '@opentelemetry/api'
import { getWebApiBaseUrl } from '@renderer/utils/platform'
import type { MCPServerLogEntry } from '@shared/config/types'
import type {
  ApiServerConfig,
  AppInfo,
  FileMetadata,
  GetApiServerStatusResult,
  MCPServer,
  MCPToolResponse
} from '@types'
import type { KnowledgeBaseParams, KnowledgeItem, KnowledgeSearchResult } from '@types'
import { FileTypes } from '@types'

type OpenDialogOptions = {
  properties?: string[]
  filters?: Array<{ name: string; extensions: string[] }>
}

type OpenedFile = { fileName: string; filePath: string; content?: Uint8Array; size: number }

const pendingFiles = new Map<string, File>()
const tempFiles = new Map<string, { name: string; content: Uint8Array | string }>()
const logger = loggerService.withContext('WebApiBridge')

function toExt(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx === -1) return ''
  return name.slice(idx)
}

function resolveFileType(file: File): FileMetadata['type'] {
  if (file.type.startsWith('image/')) return FileTypes.IMAGE
  if (file.type.startsWith('video/')) return FileTypes.VIDEO
  if (file.type.startsWith('audio/')) return FileTypes.AUDIO
  return FileTypes.OTHER
}

function createFileMetadata(file: File, id: string): FileMetadata {
  const ext = toExt(file.name)
  return {
    id,
    origin_name: file.name,
    name: `${id}${ext}`,
    path: `${id}${ext}`,
    created_at: new Date().toISOString(),
    size: file.size,
    ext,
    type: resolveFileType(file),
    count: 1
  }
}

async function uploadFileToServer(apiBase: string, file: File, id?: string): Promise<FileMetadata> {
  const ext = toExt(file.name)
  const response = await fetch(`${apiBase}/files`, {
    method: 'POST',
    headers: {
      'x-file-name': file.name,
      'x-file-origin-name': file.name,
      'x-file-id': id || crypto.randomUUID(),
      'x-file-ext': ext,
      'x-file-size': String(file.size),
      'content-type': file.type || 'application/octet-stream'
    },
    body: file
  })
  if (!response.ok) {
    throw new Error('文件上传失败')
  }
  return (await response.json()) as FileMetadata
}

function base64ToBlob(base64Data: string, fallbackType: string): Blob {
  const match = base64Data.match(/^data:(.*?);base64,/)
  const mime = match?.[1] || fallbackType
  const raw = base64Data.replace(/^data:.*;base64,/, '')
  const binary = atob(raw)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i)
  }
  return new Blob([buffer], { type: mime })
}

async function openFilePicker(options?: OpenDialogOptions): Promise<File[]> {
  const input = document.createElement('input')
  input.type = 'file'
  const allowMulti = options?.properties?.includes('multiSelections')
  if (allowMulti) {
    input.multiple = true
  }

  const extensions = options?.filters?.[0]?.extensions
  if (extensions && extensions.length > 0 && !extensions.includes('*')) {
    input.accept = extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)).join(',')
  }

  return new Promise((resolve) => {
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : []
      resolve(files)
    }
    input.click()
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const STORAGE_PREFIX = 'cs-web-file:'
const textFileExts = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.js',
  '.ts',
  '.jsx',
  '.tsx'
])

function notifyUnsupported(feature: string) {
  const message = `${feature} 在 Web 版本中不可用`
  logger.warn(message)
  window.toast?.info?.(message)
}

function openExternal(url?: string) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function createUnsupportedProxy(path: string): any {
  return new Proxy(() => undefined, {
    get: (_target, key) => {
      if (key === 'then') return undefined
      if (key === 'on' || key === 'once') return () => () => undefined
      if (key === 'off' || key === 'removeAllListeners' || key === 'removeListener') return () => undefined
      return createUnsupportedProxy(`${path}.${String(key)}`)
    },
    apply: () => {
      notifyUnsupported(path)
      return undefined
    }
  })
}

function getStoredText(key: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`)
  } catch (error) {
    logger.warn('读取本地存储失败', error as Error)
    return null
  }
}

function setStoredText(key: string, value: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, value)
  } catch (error) {
    logger.warn('写入本地存储失败', error as Error)
  }
}

function normalizeTextContent(data: Uint8Array | string): string {
  if (typeof data === 'string') return data
  return new TextDecoder().decode(data)
}

function isTextFilePath(path: string): boolean {
  const idx = path.lastIndexOf('.')
  if (idx === -1) return false
  return textFileExts.has(path.slice(idx).toLowerCase())
}

async function readTextFromServer(apiBase: string, id: string): Promise<string> {
  const response = await fetch(`${apiBase}/files/${id}/text`)
  if (response.ok) {
    return response.text()
  }
  const cached = getStoredText(id)
  if (cached !== null) {
    return cached
  }
  throw new Error('读取文件失败')
}

export function initWebApiBridge() {
  if (window.api) return

  if (!window.electron) {
    window.electron = {
      ipcRenderer: {
        on: () => () => undefined,
        once: () => () => undefined,
        off: () => undefined,
        removeAllListeners: () => undefined,
        removeListener: () => undefined,
        invoke: async () => null,
        send: () => undefined
      },
      process: {
        platform: 'web',
        env: {}
      }
    } as any
  }

  const apiBase = getWebApiBaseUrl()

  const appInfo: AppInfo = {
    version: 'web',
    isPackaged: false,
    appPath: window.location.origin,
    configPath: '',
    appDataPath: '',
    resourcesPath: window.location.origin,
    filesPath: `${apiBase}/files`,
    logsPath: '',
    arch: 'web',
    isPortable: false,
    installPath: ''
  }

  const apiServerConfig: ApiServerConfig = {
    enabled: true,
    host: window.location.hostname,
    port: Number(window.location.port || 80),
    apiKey: ''
  }

  const unsupportedFileOperation = (name: string) => async () => {
    notifyUnsupported(`window.api.file.${name}`)
  }

  const api: any = {
    getAppInfo: async () => appInfo,
    getDataPathFromArgs: async () => null,
    getDiskInfo: async () => null,
    checkForUpdate: async () => ({ updateInfo: null }),
    setProxy: async () => undefined,
    setTheme: async () => undefined,
    setFullScreen: async (value: boolean) => {
      if (value) {
        await document.documentElement.requestFullscreen?.()
      } else {
        await document.exitFullscreen?.()
      }
    },
    isFullScreen: async () => Boolean(document.fullscreenElement),
    setEnableSpellCheck: async () => undefined,
    setLaunchOnBoot: async () => undefined,
    setLaunchToTray: async () => undefined,
    setTray: async () => undefined,
    setTrayOnClose: async () => undefined,
    setAutoUpdate: async () => undefined,
    setTestPlan: async () => undefined,
    setTestChannel: async () => undefined,
    setDisableHardwareAcceleration: async () => undefined,
    isBinaryExist: async () => false,
    installBunBinary: async () => {
      notifyUnsupported('window.api.installBunBinary')
      return false
    },
    reload: () => window.location.reload(),
    quit: () => notifyUnsupported('window.api.quit'),
    quitAndInstall: () => notifyUnsupported('window.api.quitAndInstall'),
    openWebsite: (url: string) => openExternal(url),
    openPath: (path: string) => openExternal(path),
    logToMain: () => undefined,
    devTools: {
      toggle: async () => undefined
    },
    config: {
      set: async (key: string, value: unknown) => {
        try {
          localStorage.setItem(`cs-config:${key}`, JSON.stringify(value))
        } catch (error) {
          logger.warn('写入配置失败', error as Error)
        }
        return true
      }
    },
    window: {
      getSize: async () => [window.innerWidth, window.innerHeight],
      setMinimumSize: async () => undefined,
      resetMinimumSize: async () => undefined
    },
    windowControls: {
      isMaximized: async () => false,
      onMaximizedChange: () => () => undefined,
      minimize: () => undefined,
      unmaximize: () => undefined,
      maximize: () => undefined,
      close: () => undefined
    },
    apiServer: {
      getStatus: async (): Promise<GetApiServerStatusResult> => ({ running: true, config: apiServerConfig }),
      start: async () => ({ success: true }),
      stop: async () => ({ success: true }),
      restart: async () => ({ success: true }),
      onReady: () => () => undefined
    },
    system: {
      getDeviceType: async () => 'web',
      getHostname: async () => window.location.hostname,
      getCpuName: async () => 'browser',
      checkGitBash: async () => false,
      getGitBashPath: async () => null,
      getGitBashPathInfo: async () => null,
      setGitBashPath: async () => false
    },
    zip: {
      compress: async (text: string) => text,
      decompress: async (data: Uint8Array) => new TextDecoder().decode(data)
    },
    backup: {
      backup: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      restore: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      backupToWebdav: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      restoreFromWebdav: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      listWebdavFiles: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      checkConnection: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      createDirectory: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      deleteWebdavFile: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      backupToLocalDir: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      restoreFromLocalBackup: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      listLocalBackupFiles: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      deleteLocalBackupFile: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      checkWebdavConnection: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      backupToS3: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      restoreFromS3: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      listS3Files: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      deleteS3File: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      checkS3Connection: async () => {
        throw new Error('Web 环境不支持该功能')
      }
    },
    file: {
      select: async (options?: OpenDialogOptions): Promise<FileMetadata[] | null> => {
        const files = await openFilePicker(options)
        if (files.length === 0) return null
        const metas = files.map((file) => {
          const id = crypto.randomUUID()
          pendingFiles.set(id, file)
          return createFileMetadata(file, id)
        })
        return metas
      },
      upload: async (file: FileMetadata): Promise<FileMetadata> => {
        const pending = pendingFiles.get(file.id)
        if (!pending) {
          return file
        }
        pendingFiles.delete(file.id)
        return uploadFileToServer(apiBase, pending, file.id)
      },
      base64File: async (id: string) => {
        const response = await fetch(`${apiBase}/files/${id}/base64`)
        if (!response.ok) {
          throw new Error('读取文件失败')
        }
        return response.json()
      },
      binaryImage: async (id: string) => {
        const response = await fetch(`${apiBase}/files/${id}`)
        if (!response.ok) {
          throw new Error('读取文件失败')
        }
        const buffer = await response.arrayBuffer()
        return { data: new Uint8Array(buffer), mime: response.headers.get('content-type') || '' }
      },
      read: async (id: string) => readTextFromServer(apiBase, id),
      readExternal: async (filePath: string) => {
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
          const response = await fetch(filePath)
          if (!response.ok) {
            throw new Error('读取文件失败')
          }
          return response.text()
        }
        if (filePath.startsWith('file://')) {
          notifyUnsupported('window.api.file.readExternal')
          throw new Error('Web 环境不支持读取本地路径')
        }
        const cached = getStoredText(filePath)
        if (cached !== null) {
          return cached
        }
        return readTextFromServer(apiBase, filePath)
      },
      delete: async (id: string) => {
        await fetch(`${apiBase}/files/${id}`, { method: 'DELETE' })
      },
      deleteDir: unsupportedFileOperation('deleteDir'),
      deleteExternalFile: unsupportedFileOperation('deleteExternalFile'),
      deleteExternalDir: unsupportedFileOperation('deleteExternalDir'),
      move: unsupportedFileOperation('move'),
      moveDir: unsupportedFileOperation('moveDir'),
      rename: unsupportedFileOperation('rename'),
      renameDir: unsupportedFileOperation('renameDir'),
      clear: async () => {
        await fetch(`${apiBase}/files`, { method: 'DELETE' })
      },
      get: async (filePath: string): Promise<FileMetadata | null> => {
        const entry = tempFiles.get(filePath)
        if (!entry) return null
        const blob =
          typeof entry.content === 'string'
            ? new Blob([entry.content], { type: 'text/plain' })
            : new Blob([entry.content])
        const file = new File([blob], entry.name)
        const id = crypto.randomUUID()
        pendingFiles.set(id, file)
        return createFileMetadata(file, id)
      },
      createTempFile: async (name: string) => {
        const id = `temp-${crypto.randomUUID()}`
        tempFiles.set(id, { name, content: '' })
        return id
      },
      mkdir: unsupportedFileOperation('mkdir'),
      write: async (path: string, data: Uint8Array | string) => {
        const entry = tempFiles.get(path)
        if (entry) {
          entry.content = data
          return
        }
        const normalized = normalizeTextContent(data)
        setStoredText(path, normalized)
      },
      writeWithId: async (id: string, content: string) => {
        setStoredText(id, content)
      },
      open: async (options?: OpenDialogOptions): Promise<OpenedFile | null> => {
        const files = await openFilePicker({ ...options, properties: ['openFile'] })
        if (files.length === 0) return null
        const file = files[0]
        const buffer = await file.arrayBuffer()
        return {
          fileName: file.name,
          filePath: file.name,
          content: new Uint8Array(buffer),
          size: file.size
        }
      },
      openPath: async (path: string) => openExternal(path),
      save: async (fileName: string, content: string | ArrayBufferView) => {
        const blob =
          typeof content === 'string'
            ? new Blob([content], { type: 'text/plain' })
            : new Blob([content], { type: 'application/octet-stream' })
        downloadBlob(blob, fileName)
        return true
      },
      selectFolder: async () => null,
      saveImage: async (fileName: string, dataUrl: string) => {
        const response = await fetch(dataUrl)
        const blob = await response.blob()
        downloadBlob(blob, fileName)
      },
      base64Image: async (id: string) => {
        const result = await api.file.base64File(id)
        const mime = result.mime || 'image/png'
        return { mime, base64: result.data, data: `data:${mime};base64,${result.data}` }
      },
      saveBase64Image: async (data: string): Promise<FileMetadata> => {
        const blob = base64ToBlob(data, 'image/png')
        const file = new File([blob], `image-${Date.now()}.png`, { type: blob.type })
        return uploadFileToServer(apiBase, file)
      },
      savePastedImage: async (imageData: Uint8Array, extension?: string): Promise<FileMetadata> => {
        const ext = extension?.startsWith('.') ? extension : `.${extension || 'png'}`
        const mime = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`
        const file = new File([imageData], `pasted-${Date.now()}${ext}`, { type: mime })
        return uploadFileToServer(apiBase, file)
      },
      download: async (url: string) => {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error('下载失败')
        }
        const blob = await response.blob()
        const name = url.split('/').pop() || 'download'
        downloadBlob(blob, name)
      },
      copy: unsupportedFileOperation('copy'),
      pdfInfo: async () => 1,
      getPathForFile: (file: File) => file.name,
      openFileWithRelativePath: async (file: FileMetadata) => {
        const key = file?.name || file?.id
        if (!key) return
        openExternal(`${apiBase}/files/${key}`)
      },
      isTextFile: async (filePath: string) => isTextFilePath(filePath),
      getDirectoryStructure: async () => {
        notifyUnsupported('window.api.file.getDirectoryStructure')
        return []
      },
      listDirectory: async () => {
        notifyUnsupported('window.api.file.listDirectory')
        return []
      },
      checkFileName: async (_dirPath: string, fileName: string) => ({ safeName: fileName, exists: false }),
      validateNotesDirectory: async () => false,
      startFileWatcher: async () => false,
      stopFileWatcher: async () => undefined,
      pauseFileWatcher: async () => undefined,
      resumeFileWatcher: async () => undefined,
      batchUploadMarkdown: async () => [],
      onFileChange: () => () => undefined,
      showInFolder: unsupportedFileOperation('showInFolder')
    },
    fs: {
      read: async (path: string, encoding?: string) => {
        if (path.startsWith('file://')) {
          notifyUnsupported('window.api.fs.read')
          throw new Error('Web 环境不支持读取本地路径')
        }
        const response = await fetch(path)
        if (!response.ok) {
          throw new Error('读取文件失败')
        }
        if (encoding) {
          return response.text()
        }
        const buffer = await response.arrayBuffer()
        return new Uint8Array(buffer)
      },
      readText: async (path: string) => {
        if (path.startsWith('file://')) {
          notifyUnsupported('window.api.fs.readText')
          throw new Error('Web 环境不支持读取本地路径')
        }
        const response = await fetch(path)
        if (!response.ok) {
          throw new Error('读取文件失败')
        }
        return response.text()
      }
    },
    knowledgeBase: {
      create: async (base: KnowledgeBaseParams, _context?: SpanContext) => {
        void _context
        await fetch(`${apiBase}/knowledge/create`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(base)
        })
        return { success: true }
      },
      reset: async (base: KnowledgeBaseParams) => {
        await fetch(`${apiBase}/knowledge/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(base)
        })
        return { success: true }
      },
      delete: async (id: string) => {
        await fetch(`${apiBase}/knowledge/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id })
        })
        return { success: true }
      },
      add: async ({
        base,
        item,
        userId,
        forceReload = false
      }: {
        base: KnowledgeBaseParams
        item: KnowledgeItem
        userId?: string
        forceReload?: boolean
      }) => {
        void userId
        void forceReload
        const response = await fetch(`${apiBase}/knowledge/add`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ base, item })
        })
        if (!response.ok) {
          throw new Error('知识库写入失败')
        }
        return response.json()
      },
      remove: async ({
        uniqueId,
        uniqueIds,
        base
      }: {
        uniqueId: string
        uniqueIds: string[]
        base: KnowledgeBaseParams
      }) => {
        const response = await fetch(`${apiBase}/knowledge/remove`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ base, uniqueId, uniqueIds })
        })
        if (!response.ok) {
          throw new Error('知识库移除失败')
        }
        return response.json()
      },
      search: async (
        payload: { search: string; base: KnowledgeBaseParams },
        _context?: SpanContext
      ): Promise<KnowledgeSearchResult[]> => {
        void _context
        const response = await fetch(`${apiBase}/knowledge/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          throw new Error('知识库检索失败')
        }
        return response.json()
      },
      rerank: async (
        payload: { search: string; base: KnowledgeBaseParams; results: KnowledgeSearchResult[] },
        _context?: SpanContext
      ) => {
        void _context
        const response = await fetch(`${apiBase}/knowledge/rerank`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          throw new Error('知识库重排失败')
        }
        return response.json()
      },
      checkQuota: async (_payload: { base: KnowledgeBaseParams; userId: string }) => {
        const response = await fetch(`${apiBase}/knowledge/check-quota`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(_payload)
        })
        if (!response.ok) {
          return 0
        }
        return response.json()
      }
    },
    mcp: {
      removeServer: async (_server: MCPServer) => {
        void _server
        return { success: true }
      },
      restartServer: async (_server: MCPServer) => {
        void _server
        return { success: true }
      },
      stopServer: async (_server: MCPServer) => {
        void _server
        return { success: true }
      },
      listTools: async (server: MCPServer, _context?: SpanContext) => {
        void _context
        const response = await fetch(`${apiBase}/mcp/list-tools`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ server })
        })
        if (!response.ok) {
          throw new Error('获取 MCP 工具失败')
        }
        return response.json()
      },
      callTool: async (
        payload: { server: MCPServer; name: string; args: any; callId?: string },
        _context?: SpanContext
      ): Promise<MCPToolResponse> => {
        void _context
        const response = await fetch(`${apiBase}/mcp/call-tool`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          throw new Error('调用 MCP 工具失败')
        }
        return response.json()
      },
      listPrompts: async (server: MCPServer) => {
        const response = await fetch(`${apiBase}/mcp/list-prompts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ server })
        })
        if (!response.ok) {
          throw new Error('获取 MCP Prompts 失败')
        }
        return response.json()
      },
      getPrompt: async (payload: { server: MCPServer; name: string; args?: Record<string, any> }) => {
        const response = await fetch(`${apiBase}/mcp/get-prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          throw new Error('获取 MCP Prompt 失败')
        }
        return response.json()
      },
      listResources: async (server: MCPServer) => {
        const response = await fetch(`${apiBase}/mcp/list-resources`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ server })
        })
        if (!response.ok) {
          throw new Error('获取 MCP 资源失败')
        }
        return response.json()
      },
      getResource: async (payload: { server: MCPServer; uri: string }) => {
        const response = await fetch(`${apiBase}/mcp/get-resource`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          throw new Error('获取 MCP 资源失败')
        }
        return response.json()
      },
      abortTool: async (callId: string) => {
        await fetch(`${apiBase}/mcp/abort`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callId })
        })
        return true
      },
      getServerVersion: async (server: MCPServer) => {
        const response = await fetch(`${apiBase}/mcp/server-version`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ server })
        })
        if (!response.ok) {
          return null
        }
        const data = await response.json()
        return data.version || null
      },
      getServerLogs: async (server: MCPServer): Promise<MCPServerLogEntry[]> => {
        const response = await fetch(`${apiBase}/mcp/server-logs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ server })
        })
        if (!response.ok) {
          return []
        }
        return response.json()
      },
      checkMcpConnectivity: async (server: MCPServer) => {
        try {
          await api.mcp.listTools(server)
          return true
        } catch {
          return false
        }
      },
      getInstallInfo: async () => ({ dir: '', uvPath: '', bunPath: '' }),
      uploadDxt: async () => {
        throw new Error('Web 环境不支持该功能')
      },
      onServerLog: () => () => undefined
    },
    fileService: {
      upload: async (_provider: unknown, file: FileMetadata) => {
        void _provider
        notifyUnsupported('window.api.fileService.upload')
        return { fileId: file.id, displayName: file.origin_name, status: 'failed' }
      },
      list: async () => ({ files: [] }),
      delete: async () => undefined,
      retrieve: async (_provider: unknown, fileId: string) => {
        void _provider
        return {
          fileId,
          displayName: fileId,
          status: 'failed'
        }
      }
    },
    memory: {
      list: async () => ({ memories: [], count: 0 }),
      add: async () => ({ memories: [], count: 0 }),
      search: async () => ({ memories: [], count: 0 }),
      delete: async () => undefined,
      update: async () => undefined,
      get: async () => [],
      deleteAllMemoriesForUser: async () => undefined,
      deleteUser: async () => undefined,
      getUsersList: async () => [],
      setConfig: async () => undefined
    },
    notification: {
      send: async (notification: any) => {
        try {
          if (typeof Notification === 'undefined') {
            window.toast?.info?.(notification?.message || notification?.title)
            return
          }
          if (Notification.permission === 'granted') {
            new Notification(notification?.title || '', { body: notification?.message })
            return
          }
          if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission()
            if (permission === 'granted') {
              new Notification(notification?.title || '', { body: notification?.message })
              return
            }
          }
          window.toast?.info?.(notification?.message || notification?.title)
        } catch (error) {
          logger.warn('发送通知失败', error as Error)
        }
      }
    },
    searchService: {
      openUrlInSearchWindow: async (_uid: string, url: string) => {
        void _uid
        openExternal(url)
        return url
      },
      closeSearchWindow: async () => undefined
    },
    shortcuts: {
      update: async () => undefined
    },
    export: {
      toWord: async (content: string, name: string) => {
        const fileName = name.endsWith('.doc') || name.endsWith('.docx') ? name : `${name}.doc`
        const blob = new Blob([content], { type: 'application/msword' })
        downloadBlob(blob, fileName)
      }
    },
    trace: {
      saveEntity: async () => undefined,
      addStreamMessage: async () => undefined,
      tokenUsage: async () => undefined,
      bindTopic: async () => undefined,
      cleanHistory: async () => undefined,
      cleanTopic: async () => undefined,
      openWindow: async () => undefined,
      saveData: async () => undefined,
      addEndMessage: async () => undefined,
      getData: async () => []
    },
    protocol: {
      onReceiveData: () => () => undefined
    },
    aes: {
      decrypt: async () => {
        notifyUnsupported('window.api.aes.decrypt')
        return ''
      }
    },
    shell: {
      openExternal: (url: string) => openExternal(url)
    },
    agentTools: {
      respondToPermission: async () => ({ success: true })
    },
    copilot: {
      getToken: async () => {
        notifyUnsupported('window.api.copilot.getToken')
        throw new Error('Web 版本不支持 Copilot 认证')
      }
    },
    cherryai: {
      generateSignature: async () => {
        notifyUnsupported('window.api.cherryai.generateSignature')
        throw new Error('Web 版本不支持 CherryAI 签名')
      }
    },
    anthropic_oauth: {
      getAccessToken: async () => {
        notifyUnsupported('window.api.anthropic_oauth.getAccessToken')
        throw new Error('Web 版本不支持 Anthropic OAuth')
      }
    },
    vertexAI: {
      getAuthHeaders: async () => {
        notifyUnsupported('window.api.vertexAI.getAuthHeaders')
        return {}
      },
      clearAuthCache: async () => undefined
    },
    claudeCodePlugin: {
      listAvailable: async () => [],
      listInstalled: async () => [],
      install: async () => ({ success: false }),
      uninstall: async () => ({ success: false })
    },
    ocr: {
      ocr: async () => {
        notifyUnsupported('window.api.ocr.ocr')
        return ''
      }
    },
    ovms: {
      getStatus: async () => 'not-running'
    },
    webview: createUnsupportedProxy('window.api.webview'),
    webSocket: createUnsupportedProxy('window.api.webSocket'),
    codeTools: createUnsupportedProxy('window.api.codeTools'),
    obsidian: createUnsupportedProxy('window.api.obsidian'),
    nutstore: createUnsupportedProxy('window.api.nutstore')
  }

  window.api = api as any
}
