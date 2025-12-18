import '@testing-library/jest-dom/vitest'

import { createRequire } from 'node:module'
import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { expect, vi } from 'vitest'

const require = createRequire(import.meta.url)
const bufferModule = require('buffer') as typeof import('buffer') & { SlowBuffer?: typeof Buffer }

expect.addSnapshotSerializer(styleSheetSerializer)

// 为依赖提供 SlowBuffer 兼容（新版本 Node 中 SlowBuffer 已移除/不可用）
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
if (!(Buffer as any).SlowBuffer) (Buffer as any).SlowBuffer = bufferModule.SlowBuffer
if (!(Buffer as any).prototype.equal) {
  ;(Buffer as any).prototype.equal = Buffer.prototype.equals
}
;(globalThis as any).SlowBuffer = bufferModule.SlowBuffer

// 在任何 require() 触发前硬注入 buffer-equal-constant-time（避免其访问 SlowBuffer.prototype）
try {
  const bectPath = require.resolve('buffer-equal-constant-time')
  const mockFn = (a: any, b: any) => {
    if (a && b && typeof a.equals === 'function') return a.equals(b)
    return a === b
  }
  ;(require.cache as any)[bectPath] = {
    id: bectPath,
    filename: bectPath,
    loaded: true,
    exports: mockFn
  }
} catch {
  // 在某些上下文中可能无法解析，忽略即可
}

// Mock LoggerService globally for renderer tests
vi.mock('@logger', async () => {
  const { MockRendererLoggerService, mockRendererLoggerService } = await import('./__mocks__/RendererLoggerService')
  return {
    LoggerService: MockRendererLoggerService,
    loggerService: mockRendererLoggerService
  }
})

// Mock uuid globally for renderer tests
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: () => 'test-uuid-' + ++uuidCounter
}))

vi.mock('axios', () => {
  const defaultAxiosMock = {
    get: vi.fn().mockResolvedValue({ data: {} }), // Mocking axios GET request
    post: vi.fn().mockResolvedValue({ data: {} }) // Mocking axios POST request
    // You can add other axios methods like put, delete etc. as needed
  }

  const isAxiosError = (error: unknown): error is { isAxiosError?: boolean } =>
    Boolean((error as { isAxiosError?: boolean } | undefined)?.isAxiosError)

  return {
    default: defaultAxiosMock,
    isAxiosError
  }
})

vi.stubGlobal('electron', {
  ipcRenderer: {
    on: vi.fn(),
    send: vi.fn()
  }
})
vi.stubGlobal('api', {
  file: {
    read: vi.fn().mockResolvedValue('[]'),
    writeWithId: vi.fn().mockResolvedValue(undefined)
  }
})

if (typeof globalThis.localStorage === 'undefined' || typeof (globalThis.localStorage as any).getItem !== 'function') {
  let store = new Map<string, string>()

  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }

  vi.stubGlobal('localStorage', localStorageMock)
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
  }
}

// i18n 等模块可能依赖浏览器语境的 navigator
vi.stubGlobal('navigator', {
  language: 'en-US',
  languages: ['en-US'],
  userAgent: 'vitest'
})
