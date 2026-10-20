/**
 * Where this fork publishes its builds. The `publish` section of `electron-builder.yml` names the
 * same repository and becomes the packaged app's `app-update.yml`, so electron-updater reads its
 * feed (`latest*.yml`) from these GitHub Releases. `scripts/__tests__/fork-update-feed.test.ts`
 * keeps the build configs in sync with these constants.
 */
export const FORK_RELEASE_OWNER = 'atoz03'
export const FORK_RELEASE_REPO = 'cherry-studio'

/** Human-facing release list, for "view releases" / download links. */
export const FORK_RELEASES_URL = `https://github.com/${FORK_RELEASE_OWNER}/${FORK_RELEASE_REPO}/releases`
