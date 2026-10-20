import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReportFirstFrame } from '../useReportFirstFrame'

const mocks = vi.hoisted(() => ({ request: vi.fn(async () => {}) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

let frames: FrameRequestCallback[] = []

beforeEach(() => {
  vi.clearAllMocks()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const runFrames = () => {
  const pending = frames
  frames = []
  for (const callback of pending) callback(performance.now())
}

describe('useReportFirstFrame', () => {
  it('reports once the frame that paints the first commit is out, not before', () => {
    renderHook(() => useReportFirstFrame())
    expect(mocks.request).not.toHaveBeenCalled()

    runFrames()
    expect(mocks.request).not.toHaveBeenCalled()

    runFrames()
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('window.report_first_frame')
  })

  it('waits until the shell is ready, then reports once across later renders', () => {
    const { rerender } = renderHook(({ ready }) => useReportFirstFrame(ready), { initialProps: { ready: false } })
    runFrames()
    expect(mocks.request).not.toHaveBeenCalled()

    rerender({ ready: true })
    runFrames()
    runFrames()
    rerender({ ready: false })
    rerender({ ready: true })
    runFrames()
    runFrames()

    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
})
