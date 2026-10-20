import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SignatureClient } from '../cherryai'

describe('SignatureClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T15:06:40.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('keeps the v1 chat completion signature stable', () => {
    const client = new SignatureClient('test-client', 'test-secret')

    expect(
      client.generateSignature({
        method: 'POST',
        path: '/chat/completions',
        body: { model: 'test' }
      })
    ).toEqual({
      'X-Client-ID': 'test-client',
      'X-Timestamp': '1750000000',
      'X-Signature': '89fdf838e8f1504e1af28c33f8b64c0699e61d14405d9f946c9cdb89138a2992'
    })
  })

  it('rejects an explicitly empty client secret without exposing it', () => {
    expect(() => new SignatureClient('test-client', '')).toThrow('CherryAI client secret is not configured')
  })

  it('fails closed when the build client secret is missing', async () => {
    vi.stubEnv('MAIN_VITE_CHERRYAI_CLIENT_SECRET', '')
    vi.resetModules()
    const { generateSignature } = await import('../cherryai')

    expect(() => generateSignature({ method: 'POST', path: '/chat/completions' })).toThrow(
      'CherryAI client secret is not configured'
    )
  })
})
