import type { AppUpdater } from 'electron-updater'

import { FORK_RELEASES_URL } from '@shared/utils/forkRelease'

/** The releases feed electron-updater's GitHub provider requests first on every check. */
export const FORK_UPDATE_FEED_URL = `${FORK_RELEASES_URL}.atom`

/** Updater settings that decide which fork release is offered; everything else stays per-instance. */
export type ForkFeedSettings = Pick<AppUpdater, 'allowPrerelease' | 'allowDowngrade' | 'requestHeaders'>

/**
 * Point an electron-updater instance at this fork's release line.
 *
 * The feed itself (GitHub Releases of atoz03/cherry-studio) comes from `app-update.yml`, which
 * electron-builder writes from the `publish` section of `electron-builder.yml`
 * (`dev-app-update.yml` in development). This only decides which release on that feed counts:
 *
 * - Read GitHub's release marked latest. A build whose version carries a prerelease tag would make
 *   electron-updater default `allowPrerelease` to true, and its GitHub provider would then walk
 *   the feed for a tag with the same prerelease id instead. Fork releases are published as regular
 *   releases marked latest (`.github/workflows/release.yml`), ordered by semver from 3.0.0.
 * - Never offer an older release, e.g. after the latest release is deleted or re-marked.
 * - `channel` stays unset: its setter silently re-enables downgrades, and the China edition gets
 *   its `latest-cn` channel from `app-update.yml`.
 * - No identifying headers (client id, region, edition) — only the no-cache header that the
 *   patched electron-updater relies on instead of a cache-busting query parameter.
 */
export function applyForkUpdateFeed(updater: ForkFeedSettings): void {
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.requestHeaders = { 'Cache-Control': 'no-cache' }
}
