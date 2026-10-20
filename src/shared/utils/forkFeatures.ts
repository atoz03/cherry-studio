/**
 * Build-time switches for upstream features this fork ships without.
 *
 * A disabled feature keeps its upstream code (so upstream syncs stay conflict-free) but is
 * never started, shown, or packaged: main-process services gate on these constants, the
 * renderer hides the matching UI, and `electron-builder.yml` excludes their dependencies.
 * Flip a switch only together with those exclusions — `forkFeatures.test.ts` checks both.
 */

/** Pairing the desktop with the mobile app over LAN/VPN ("Device Connections"). */
export const FORK_REMOTE_ACCESS_ENABLED = false

/** Uploading diagnostic bundles to upstream's support backend. */
export const FORK_DIAGNOSTICS_UPLOAD_ENABLED = false

/**
 * Upstream's RC/Beta update channels ("test plan"). The fork publishes one release line on its
 * GitHub Releases, so there is no other channel to join.
 */
export const FORK_TEST_PLAN_ENABLED = false
