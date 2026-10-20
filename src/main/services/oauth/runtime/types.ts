import type { PkceOAuthClient } from './PkceOAuthClient'

export interface OAuthAccount {
  /** Provider account id associated with the OAuth session, when available. */
  accountId: string | null
}

export interface OAuthTokenCredentials {
  accessToken: string
  accountId?: string | null
}

export interface OAuthTokenStoreData {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountId?: string
}

export interface OAuthTokenStore {
  get(providerId: string): Promise<OAuthTokenStoreData | null>
  /**
   * Persist the OAuth session. When `expectedRefreshToken` is given the write is
   * a no-op unless the stored session is still OAuth *and* still carries that
   * exact refresh token — the refresh path uses it so a network round-trip that
   * resolves after a logout (session → api-key) or a re-login (a different
   * session) cannot clobber the current credential with its now-stale token.
   */
  set(
    providerId: string,
    data: OAuthTokenStoreData,
    clientId: string,
    options?: { expectedRefreshToken?: string }
  ): Promise<void>
  /**
   * Drop the stored OAuth tokens and disable the provider — the OAuth session is
   * its only credential.
   */
  clear(
    providerId: string,
    options?: {
      /**
       * Conditional clear (a terminal refresh failure): only drop the session
       * when it still carries this refresh token, so a re-login that landed
       * during the failed refresh is not torn down with it. Omit for a
       * user-initiated logout, which clears unconditionally.
       */
      expectedRefreshToken?: string
    }
  ): Promise<void>
}

export interface LoopbackCallbackConfig {
  /** Loopback hosts to bind, in priority order (e.g. ['127.0.0.1', '::1']). */
  hosts: readonly string[]
  port: number
  /** Callback path the provider redirects to (e.g. '/auth/callback'). */
  path: string
  /** Full redirect URI registered with the provider's OAuth client. */
  redirectUri: string
}

export interface OAuthRuntimeProviderDefinition {
  providerId: string
  clientId: string
  transport: LoopbackCallbackConfig
  /** `signal` aborts any discovery the client needs before the flow starts (Grok). */
  createClient(context?: { signal?: AbortSignal }): PkceOAuthClient | Promise<PkceOAuthClient>
  extractAccountId?(accessToken: string): string | null
}
