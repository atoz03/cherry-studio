import '@testing-library/jest-dom/vitest'

import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { createRequire } from 'node:module'
import { expect, vi } from 'vitest'
import * as bufferModule from 'buffer'

const require = createRequire(import.meta.url)

expect.addSnapshotSerializer(styleSheetSerializer)

// Provide SlowBuffer compatibility for dependencies expecting it
// (Node 20+ deprecates/removed SlowBuffer)
if (!(bufferModule as any).SlowBuffer) {
  ;(bufferModule as any).SlowBuffer = Buffer
}
if (!(Buffer as any).SlowBuffer) {
  ;(Buffer as any).SlowBuffer = Buffer
}
if (!(Buffer as any).prototype.equal) {
  ;(Buffer as any).prototype.equal = Buffer.prototype.equals
}
;(globalThis as any).SlowBuffer = (bufferModule as any).SlowBuffer

// Hard mock buffer-equal-constant-time before any require() usage (fixes Node 20+ removal of SlowBuffer)
try {
  const bectPath = require.resolve('buffer-equal-constant-time')
  const mockFn = (a: any, b: any) => {
    if (a && b && typeof a.equals === 'function') return a.equals(b)
    return a === b
  }
  require.cache[bectPath] = {
    id: bectPath,
    filename: bectPath,
    loaded: true,
    exports: mockFn
  }
} catch (err) {
  // ignore if not resolvable in context
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

// Provide browser-like globals used by i18n and other modules in tests
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    }
  }
})()

vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('navigator', {
  language: 'en-US',
  languages: ['en-US'],
  userAgent: 'vitest'
})

// Some third-party deps expect Node.js SlowBuffer which is removed in newer Node.
// Mock buffer-equal-constant-time to avoid SlowBuffer prototype access in tests.
vi.mock('buffer-equal-constant-time', () => {
  const fn = (a: any, b: any) => {
    if (a && b && typeof a.equals === 'function') return a.equals(b)
    return a === b
  }
  return fn
})
