import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'

const mocks = vi.hoisted(() => ({
  errorDetailModuleEvaluated: vi.fn(),
  showErrorDetailPopup: vi.fn()
}))

vi.mock('@renderer/components/ErrorDetailModal', () => {
  mocks.errorDetailModuleEvaluated()
  return { showErrorDetailPopup: mocks.showErrorDetailPopup }
})

const { useMessageErrorActions } = await import('../useMessageErrorActions')
const errorDetailEvaluationsDuringHookImport = mocks.errorDetailModuleEvaluated.mock.calls.length

describe('useMessageErrorActions', () => {
  beforeEach(() => {
    mocks.showErrorDetailPopup.mockReset()
    vi.clearAllMocks()
  })

  it('loads the error detail popup only when invoked', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = { message: 'provider unavailable', name: 'ProviderError', stack: '' }

    const { result } = renderHook(() => useMessageErrorActions({ getDoctorSubject: () => undefined }))

    expect(errorDetailEvaluationsDuringHookImport).toBe(0)

    await result.current.openErrorDetail?.({ message, partId: 'part-1', error })
    expect(mocks.errorDetailModuleEvaluated).toHaveBeenCalledOnce()
  })

  it('keeps the Agent identity when its runtime error has no model fields', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'agent-session:session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'error'
    } satisfies MessageListItem
    const error = { message: 'runtime failed', name: 'AgentRuntimeError', stack: '' }
    const diagnosticReport = { location: 'Agent conversation' }
    const getDoctorSubject = () => ({ kind: 'agent' as const, agentId: 'agent-1' })
    const { result } = renderHook(() => useMessageErrorActions({ diagnosticReport, getDoctorSubject }))

    await result.current.openErrorDetail?.({ message, partId: 'message-1-part-0', error })

    expect(mocks.showErrorDetailPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: 'agent', agentId: 'agent-1' },
        diagnosticReport,
        error
      })
    )
  })
})
