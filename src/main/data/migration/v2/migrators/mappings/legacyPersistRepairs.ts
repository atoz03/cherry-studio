/**
 * Final-v1 Redux Persist repairs that an accepted legacy profile may not have run.
 *
 * The migration gate admits any v1 >= 1.9.12, but the atoz03 fork's v1.9.15 persists at
 * version 206 and its v1.9.13/v1.9.14 line spent 207-211 on unrelated steps, so the stored
 * persist version cannot tell which upstream steps ran. Each repair rewrites only the exact
 * stale value its v1 step targeted, which makes it a no-op on profiles that already ran it.
 *
 * Step 207 (StepFun `anthropicApiHost`) needs no repair: an absent host keeps the registry's
 * Anthropic endpoint, exactly as the backfilled baseline value would.
 */

import type { Provider as LegacyProvider } from '@main/data/migration/legacyTypes'

const RETIRED_CHERRYIN_HOST = 'https://open.cherryin.cc'
const CURRENT_CHERRYIN_HOST = 'https://open.cherryin.net'

const RETIRED_MCP_AUTO_INSTALL_PACKAGE = '@cherry/mcp-auto-install'
const CURRENT_MCP_AUTO_INSTALL_PACKAGE = '@mcpmarket/mcp-auto-install'

/** v1 step 208: CherryIN retired the `.cc` host for `.net`. */
export function repairLegacyProvider(provider: LegacyProvider): LegacyProvider {
  const { id, apiHost, anthropicApiHost } = provider
  if (id !== 'cherryin' || (apiHost !== RETIRED_CHERRYIN_HOST && anthropicApiHost !== RETIRED_CHERRYIN_HOST)) {
    return provider
  }
  return {
    ...provider,
    apiHost: apiHost === RETIRED_CHERRYIN_HOST ? CURRENT_CHERRYIN_HOST : apiHost,
    anthropicApiHost: anthropicApiHost === RETIRED_CHERRYIN_HOST ? CURRENT_CHERRYIN_HOST : anthropicApiHost
  }
}

/** v1 step 209: the auto-install server's `@cherry/mcp-auto-install` npm package was removed. */
export function repairLegacyMcpServer(server: Record<string, unknown>): Record<string, unknown> {
  const { name, args } = server
  if (name !== RETIRED_MCP_AUTO_INSTALL_PACKAGE || !Array.isArray(args)) return server
  if (!args.includes(RETIRED_MCP_AUTO_INSTALL_PACKAGE)) return server
  return {
    ...server,
    args: args.map((arg) => (arg === RETIRED_MCP_AUTO_INSTALL_PACKAGE ? CURRENT_MCP_AUTO_INSTALL_PACKAGE : arg))
  }
}
