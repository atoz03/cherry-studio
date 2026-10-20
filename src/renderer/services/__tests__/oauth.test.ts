import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  toastError: vi.fn(),
  translate: vi.fn((key: string) => key)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: mocks.loggerError,
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: mocks.translate }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: vi.fn(),
    request: vi.fn()
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

import { oauthWith302AI, oauthWithAiOnly, oauthWithSiliconFlow, providerBills, providerCharge } from '../oauth'

interface MockPopup {
  closed: boolean
  close: ReturnType<typeof vi.fn>
}

const openedPopups: MockPopup[] = []

function createPopup(): MockPopup {
  const popup: MockPopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true
    })
  }
  openedPopups.push(popup)
  return popup
}

function dispatchPopupMessage(popup: MockPopup, origin: string, data: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin,
      source: popup as unknown as Window
    })
  )
}

describe('popup message OAuth flows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    openedPopups.length = 0
    vi.spyOn(window, 'open').mockImplementation(() => createPopup() as unknown as Window)
  })

  afterEach(() => {
    for (const popup of openedPopups) popup.closed = true
    vi.advanceTimersByTime(500)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('accepts only the expected Silicon popup and origin, then removes the listener', async () => {
    const setKey = vi.fn()
    await oauthWithSiliconFlow(setKey)
    const popup = openedPopups[0]
    const otherPopup = createPopup()
    const payload = [{ secretKey: 'silicon-key' }]

    dispatchPopupMessage(popup, 'https://attacker.example', payload)
    dispatchPopupMessage(otherPopup, 'https://account.siliconflow.cn', payload)
    expect(setKey).not.toHaveBeenCalled()

    dispatchPopupMessage(popup, 'https://account.siliconflow.cn', payload)
    await vi.waitFor(() => expect(setKey).toHaveBeenCalledWith('silicon-key'))

    expect(setKey).toHaveBeenCalledOnce()
    expect(popup.close).toHaveBeenCalledOnce()

    dispatchPopupMessage(popup, 'https://account.siliconflow.cn', payload)
    expect(setKey).toHaveBeenCalledOnce()
  })

  it('retires the previous handler when another flow reuses the oauth popup name', async () => {
    const setSiliconKey = vi.fn()
    const set302Key = vi.fn()
    await oauthWithSiliconFlow(setSiliconKey)
    const siliconPopup = openedPopups[0]

    await oauthWith302AI(set302Key)
    const popup302 = openedPopups[1]

    dispatchPopupMessage(siliconPopup, 'https://account.siliconflow.cn', [{ secretKey: 'stale-key' }])
    dispatchPopupMessage(popup302, 'https://dash.302.ai', { data: { apikey: '302-key' } })
    await vi.waitFor(() => expect(set302Key).toHaveBeenCalledWith('302-key'))

    expect(setSiliconKey).not.toHaveBeenCalled()
  })

  it('keeps the previous flow active when its replacement popup is blocked', async () => {
    const setSiliconKey = vi.fn()
    await oauthWithSiliconFlow(setSiliconKey)
    const siliconPopup = openedPopups[0]

    vi.mocked(window.open).mockReturnValueOnce(null)
    await oauthWith302AI(vi.fn())

    dispatchPopupMessage(siliconPopup, 'https://account.siliconflow.cn', [{ secretKey: 'silicon-key' }])
    await vi.waitFor(() => expect(setSiliconKey).toHaveBeenCalledWith('silicon-key'))
  })

  it.each([
    ['charge', providerCharge],
    ['bills', providerBills]
  ] as const)('preserves the OAuth handler when %s opens in the system browser', async (_label, openPage) => {
    const setKey = vi.fn()
    await oauthWithSiliconFlow(setKey)
    const oauthPopup = openedPopups[0]

    await openPage('silicon')
    dispatchPopupMessage(oauthPopup, 'https://account.siliconflow.cn', [{ secretKey: 'stale-key' }])

    await vi.waitFor(() => expect(setKey).toHaveBeenCalledWith('stale-key'))
  })

  it('removes a handler when its popup closes', async () => {
    const setKey = vi.fn()
    await oauthWith302AI(setKey)
    const popup = openedPopups[0]

    popup.closed = true
    vi.advanceTimersByTime(500)
    dispatchPopupMessage(popup, 'https://dash.302.ai', { data: { apikey: 'late-key' } })

    expect(setKey).not.toHaveBeenCalled()
  })

  it('removes a handler when the flow times out', async () => {
    const setKey = vi.fn()
    await oauthWith302AI(setKey)
    const popup = openedPopups[0]

    vi.advanceTimersByTime(10 * 60 * 1000)
    dispatchPopupMessage(popup, 'https://dash.302.ai', { data: { apikey: 'late-key' } })

    expect(setKey).not.toHaveBeenCalled()
  })

  it('closes the popup and stops listening when storing the key fails', async () => {
    const setKey = vi.fn().mockRejectedValue(new Error('save failed'))
    await oauthWithSiliconFlow(setKey)
    const popup = openedPopups[0]

    dispatchPopupMessage(popup, 'https://account.siliconflow.cn', [{ secretKey: 'silicon-key' }])
    await vi.waitFor(() => expect(mocks.loggerError).toHaveBeenCalledOnce())
    expect(popup.close).toHaveBeenCalledOnce()

    dispatchPopupMessage(popup, 'https://account.siliconflow.cn', [{ secretKey: 'retry-key' }])
    expect(setKey).toHaveBeenCalledOnce()
  })

  it('finishes processing a valid callback after its popup closes', async () => {
    const setKey = vi.fn()
    await oauthWith302AI(setKey)
    const popup = openedPopups[0]

    dispatchPopupMessage(popup, 'https://dash.302.ai', { data: { apikey: 'callback-key' } })
    popup.closed = true
    vi.advanceTimersByTime(500)

    await vi.waitFor(() => expect(setKey).toHaveBeenCalledWith('callback-key'))
  })

  it('accepts the AiOnly key from its login popup', async () => {
    const setKey = vi.fn()
    await oauthWithAiOnly(setKey)
    const popup = openedPopups[0]

    dispatchPopupMessage(popup, 'https://maas.aiionly.com', [{ secretKey: 'aionly-key' }])
    await vi.waitFor(() => expect(setKey).toHaveBeenCalledWith('aionly-key'))

    expect(popup.close).toHaveBeenCalledOnce()
  })
})

describe('provider websites', () => {
  afterEach(() => vi.clearAllMocks())

  it.each([
    ['charge', providerCharge, 'https://tokendance.space/credits'],
    ['bills', providerBills, 'https://tokendance.space/activity/requests']
  ] as const)(
    'opens provider %s externally instead of losing the existing browser session',
    async (_name, open, url) => {
      await open('tokendance')
      expect(ipcApi.request).toHaveBeenCalledWith('system.shell.open_external_website', url)
    }
  )
})
