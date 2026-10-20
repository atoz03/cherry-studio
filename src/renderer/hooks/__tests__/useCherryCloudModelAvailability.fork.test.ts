import { renderHook } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { useCherryCloudModelAvailability } from '../useCherryCloudModelAvailability'

const ipcRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest }, useIpcOn: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const model = (providerId: string): Model => ({
  id: `${providerId}::model`,
  providerId,
  name: 'model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children)

describe('useCherryCloudModelAvailability with FORK_CHERRY_CLOUD_ENABLED off', () => {
  it('never polls Cherry Cloud and keeps its models out of every picker', () => {
    const { result } = renderHook(() => useCherryCloudModelAvailability(true), { wrapper })

    expect(ipcRequest).not.toHaveBeenCalled()
    expect(result.current.isModelHidden(model('cherryai-subscription'), true)).toBe(true)
    expect(result.current.isModelHidden(model('cherryai-subscription'), false)).toBe(true)
    expect(result.current.isModelHidden(model('openai'), false)).toBe(false)
  })
})
