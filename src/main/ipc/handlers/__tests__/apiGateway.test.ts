import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGatewayService } = vi.hoisted(() => ({
  apiGatewayService: {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn()
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ ApiGatewayService: apiGatewayService } as any)
})

import { apiGatewayHandlers } from '../apiGateway'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('apiGatewayHandlers', () => {
  it('start returns success when the service starts cleanly', async () => {
    apiGatewayService.start.mockResolvedValue(undefined)
    expect(await apiGatewayHandlers['api_gateway.start'](undefined, ctx)).toEqual({ success: true })
  })

  it('start turns a service throw into { success: false, error }', async () => {
    apiGatewayService.start.mockRejectedValue(new Error('port in use'))
    expect(await apiGatewayHandlers['api_gateway.start'](undefined, ctx)).toEqual({
      success: false,
      error: 'port in use'
    })
  })

  it('stop and restart report success', async () => {
    apiGatewayService.stop.mockResolvedValue('stopped')
    apiGatewayService.restart.mockResolvedValue(undefined)
    expect(await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)).toEqual({ success: true, outcome: 'stopped' })
    expect(await apiGatewayHandlers['api_gateway.restart'](undefined, ctx)).toEqual({ success: true })
  })

  it('stop turns a service throw into { success: false, error }', async () => {
    apiGatewayService.stop.mockRejectedValue(new Error('preference write failed'))

    expect(await apiGatewayHandlers['api_gateway.stop'](undefined, ctx)).toEqual({
      success: false,
      error: 'preference write failed'
    })
  })
})
