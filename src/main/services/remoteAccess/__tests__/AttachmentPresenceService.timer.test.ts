import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { AttachmentPresenceService } from '../AttachmentPresenceService'

const intake = vi.hoisted(() => ({ changed: undefined as ((event: { ownerId: string }) => void) | undefined }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const { mockFileIntakeService } = await import('@test-mocks/main/FileIntakeService')
  return mockApplicationFactory({
    FileIntakeService: {
      ...mockFileIntakeService,
      onChanged: (listener: (event: { ownerId: string }) => void) => {
        intake.changed = listener
        return { dispose() {} }
      }
    }
  })
})

const owner = { ownerId: 'phone/grant', quotaKey: 'phone' }
const auth = { deviceId: 'phone', grantId: 'grant', peerIdentity: 'key' }
const input = { selectionId: 'selection', sessionId: 'session', sequence: '1', items: [] }
const DAY = 24 * 60 * 60 * 1000

describe('attachment presentation timer', () => {
  let service: AttachmentPresenceService
  const broadcasts = () => vi.mocked(application.get('IpcApiService').broadcast).mock.calls

  beforeEach(async () => {
    vi.useFakeTimers()
    BaseService.resetInstances()
    vi.mocked(application.get('IpcApiService').broadcast).mockClear()
    service = new AttachmentPresenceService()
    await service._doInit()
  })
  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
  })

  it('runs only while a selection is tracked, still broadcasting changes and expiry', async () => {
    expect(vi.getTimerCount()).toBe(0)

    service.present(owner, auth, service.connection(), input)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(broadcasts()).toEqual([['ai.agent.attachment_selections.changed', { sessionId: 'session' }]])

    intake.changed?.({ ownerId: owner.ownerId })
    await vi.advanceTimersByTimeAsync(100)
    expect(broadcasts()).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(1)

    vi.setSystemTime(Date.now() + DAY)
    await vi.advanceTimersByTimeAsync(100)
    expect(broadcasts()).toHaveLength(3)
    expect(await service.list('session')).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('broadcasts a cancellation before it stops', async () => {
    service.present(owner, auth, service.connection(), input)
    await vi.advanceTimersByTimeAsync(100)

    service.cancelOwner(owner)
    await vi.advanceTimersByTimeAsync(100)
    expect(broadcasts()).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)

    service.present(owner, auth, service.connection(), { ...input, sequence: '2' })
    expect(vi.getTimerCount()).toBe(1)
  })
})
