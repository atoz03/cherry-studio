import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(async () => ({ committed: false })) } }))

import { ipcApi } from '@renderer/ipc'

import { useNotesGitAutoCommit } from '../useNotesGitAutoCommit'

const MINUTE = 60_000
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })
const commits = () => vi.mocked(ipcApi.request).mock.calls.filter(([route]) => route === 'notes.git.auto_commit').length

const setUp = (enabled: boolean, intervalMinutes = 5, notesPath: string | undefined = '/notes') => {
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'feature.notes.git.enabled': enabled,
    'feature.notes.git.commit_interval_minutes': intervalMinutes
  })
  return renderHook(({ path }) => useNotesGitAutoCommit(path), { initialProps: { path: notesPath } })
}

beforeEach(() => {
  vi.useFakeTimers()
  MockUsePreferenceUtils.resetMocks()
  vi.mocked(ipcApi.request).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNotesGitAutoCommit', () => {
  it('commits once when the notes page opens and keeps no timer while nothing changed', () => {
    setUp(true)

    expect(commits()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('commits the configured number of minutes after the first change, once per burst of changes', () => {
    const { result } = setUp(true, 10)

    act(() => result.current.markChanged())
    advance(5 * MINUTE)
    act(() => result.current.markChanged())
    advance(5 * MINUTE - 1)
    expect(commits()).toBe(1)

    advance(1)
    expect(commits()).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('commits a pending change when the page closes and leaves no timer behind', () => {
    const { result, unmount } = setUp(true)
    act(() => result.current.markChanged())

    unmount()

    expect(commits()).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not commit again on close when nothing is pending', () => {
    const { unmount } = setUp(true)

    unmount()

    expect(commits()).toBe(1)
  })

  it('does nothing and arms no timer while versioning is off', () => {
    const { result } = setUp(false)

    act(() => result.current.markChanged())
    advance(120 * MINUTE)

    expect(commits()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does nothing without a notes folder', () => {
    const { result } = setUp(true, 5, '')

    act(() => result.current.markChanged())

    expect(commits()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops its timer as soon as versioning is turned off', () => {
    const { result, rerender } = setUp(true)
    act(() => result.current.markChanged())
    expect(vi.getTimerCount()).toBe(1)

    MockUsePreferenceUtils.setPreferenceValue('feature.notes.git.enabled', false)
    rerender({ path: '/notes' })
    act(() => result.current.markChanged())

    expect(vi.getTimerCount()).toBe(0)
  })
})
