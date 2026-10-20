import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'

const logger = loggerService.withContext('oauth')

const SILICON_CLIENT_ID = 'SFaJLLq0y6CAMoyDm81aMu'

const OAUTH_POPUP_TIMEOUT_MS = 10 * 60 * 1000
const OAUTH_POPUP_CLOSE_POLL_MS = 500
const OAUTH_POPUP_FEATURES =
  'width=720,height=720,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,alwaysOnTop=yes,alwaysRaised=yes'

type SecretKeyOAuthPayload = [{ secretKey: string }, ...unknown[]]

interface NestedApiKeyOAuthPayload {
  data: { apikey: string }
}

interface PopupMessageOAuthOptions<T> {
  authUrl: string
  popupName: string
  matches: (data: unknown) => data is T
  getKey: (data: T) => string | Promise<string>
  setKey: (key: string) => void | Promise<void>
  onError?: (error: unknown) => void
}

/** Owns the active popup flows so replacement and teardown stay lifecycle-safe. */
class OAuthPopupFlowManager {
  readonly #cleanups = new Map<string, () => void>()

  retire(popupName: string): void {
    this.#cleanups.get(popupName)?.()
  }

  register(popupName: string, cleanup: () => void): void {
    this.retire(popupName)
    this.#cleanups.set(popupName, cleanup)
  }

  release(popupName: string, cleanup: () => void): void {
    if (this.#cleanups.get(popupName) === cleanup) this.#cleanups.delete(popupName)
  }
}

const oauthPopupFlowManager = new OAuthPopupFlowManager()

function openNamedPopup(authUrl: string, popupName: string, features: string): Window | null {
  const popup = window.open(authUrl, popupName, features)
  // Only retire the current flow once its replacement actually opens.
  if (popup) oauthPopupFlowManager.retire(popupName)
  return popup
}

function isSecretKeyOAuthPayload(data: unknown): data is SecretKeyOAuthPayload {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    typeof (data[0] as { secretKey?: unknown }).secretKey === 'string'
  )
}

function isNestedApiKeyOAuthPayload(data: unknown): data is NestedApiKeyOAuthPayload {
  if (typeof data !== 'object' || data === null) return false
  const nestedData = (data as { data?: unknown }).data
  return (
    typeof nestedData === 'object' &&
    nestedData !== null &&
    typeof (nestedData as { apikey?: unknown }).apikey === 'string'
  )
}

function startPopupMessageOAuth<T>({
  authUrl,
  popupName,
  matches,
  getKey,
  setKey,
  onError
}: PopupMessageOAuthOptions<T>): void {
  const popup = openNamedPopup(authUrl, popupName, OAUTH_POPUP_FEATURES)
  if (!popup) return
  const openedPopup = popup

  const expectedOrigin = new URL(authUrl.trim()).origin
  let active = true
  let listening = true
  let processingCallback = false

  const stopListening = () => {
    if (!listening) return
    listening = false
    window.removeEventListener('message', messageHandler)
  }

  const finish = () => {
    if (!active) return
    active = false
    stopListening()
    window.clearInterval(closePollId)
    window.clearTimeout(timeoutId)
    oauthPopupFlowManager.release(popupName, finish)
  }

  function messageHandler(event: MessageEvent): void {
    const data: unknown = event.data
    if (!active || event.source !== openedPopup || event.origin !== expectedOrigin || !matches(data)) return

    // A recognized callback is terminal. Stop accepting duplicate messages,
    // but let its async payload work finish even when the callback page closes.
    processingCallback = true
    stopListening()

    void Promise.resolve()
      .then(() => getKey(data))
      .then(async (key) => {
        if (!active) return
        await setKey(key)
        if (!active) return
        openedPopup.close()
        finish()
      })
      .catch((error) => {
        if (!active) return
        openedPopup.close()
        onError?.(error)
        finish()
      })
  }

  const closePollId = window.setInterval(() => {
    if (openedPopup.closed && !processingCallback) finish()
  }, OAUTH_POPUP_CLOSE_POLL_MS)
  const timeoutId = window.setTimeout(finish, OAUTH_POPUP_TIMEOUT_MS)

  oauthPopupFlowManager.register(popupName, finish)
  window.addEventListener('message', messageHandler)
}

export const oauthWithSiliconFlow = async (setKey) => {
  const authUrl = `https://account.siliconflow.cn/oauth?client_id=${SILICON_CLIENT_ID}`

  startPopupMessageOAuth({
    authUrl,
    popupName: 'oauth',
    matches: isSecretKeyOAuthPayload,
    getKey: (data) => data[0].secretKey,
    setKey,
    onError: (error) => logger.error('[oauthWithSiliconFlow] error', error as Error)
  })
}

export const oauthWith302AI = async (setKey) => {
  const authUrl = 'https://dash.302.ai/sso/login?app=cherry-ai.com&name=Cherry%20Studio'

  startPopupMessageOAuth({
    authUrl,
    popupName: 'oauth',
    matches: isNestedApiKeyOAuthPayload,
    getKey: (data) => data.data.apikey,
    setKey,
    onError: (error) => logger.error('[oauthWith302AI] error', error as Error)
  })
}

export const oauthWithAiOnly = async (setKey) => {
  const authUrl = `https://maas.aiionly.com/login?inviteCode=1755481173663DrZBBOC0&cherryCode=01`

  startPopupMessageOAuth({
    authUrl,
    popupName: 'login',
    matches: isSecretKeyOAuthPayload,
    getKey: (data) => data[0].secretKey,
    setKey,
    onError: (error) => logger.error('[oauthWithAiOnly] error', error as Error)
  })
}

export const oauthWithTokenDance = async (setKey) => {
  try {
    const apiKey = await ipcApi.request('oauth.tokendance.authorize_api_key')
    setKey(apiKey)
  } catch (error) {
    logger.error('[oauthWithTokenDance] error', error as Error)
    toast.error(i18n.t('settings.provider.oauth.error'))
  }
}

export const providerCharge = async (provider: string) => {
  const chargeUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/expensebill'
    },
    '302ai': {
      url: 'https://dash.302.ai/charge'
    },
    aionly: {
      url: `https://maas.aiionly.com/recharge`
    },
    tokendance: {
      url: 'https://tokendance.space/credits'
    }
  }

  const { url } = chargeUrlMap[provider]

  await openExternalWebsite(url)
}

export const providerBills = async (provider: string) => {
  const billsUrlMap = {
    silicon: {
      url: 'https://cloud.siliconflow.cn/bills'
    },
    '302ai': {
      url: 'https://dash.302.ai/charge'
    },
    aionly: {
      url: `https://maas.aiionly.com/billManagement`
    },
    tokendance: {
      url: 'https://tokendance.space/activity/requests'
    }
  }

  const { url } = billsUrlMap[provider]

  await openExternalWebsite(url)
}
