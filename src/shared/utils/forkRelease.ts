/**
 * Where this fork publishes its builds. The `publish` section of `electron-builder.yml` names the
 * same repository and becomes the packaged app's `app-update.yml`, so electron-updater reads its
 * feed (`latest*.yml`) from these GitHub Releases. `scripts/__tests__/fork-update-feed.test.ts`
 * keeps the build configs in sync with these constants.
 */
export const FORK_RELEASE_OWNER = 'atoz03'
export const FORK_RELEASE_REPO = 'cherry-studio'

/** The fork's repository page: the app's homepage in About, OAuth client metadata and user agents. */
export const FORK_REPO_URL = `https://github.com/${FORK_RELEASE_OWNER}/${FORK_RELEASE_REPO}`

/** Human-facing release list, for "view releases" / download links. */
export const FORK_RELEASES_URL = `${FORK_REPO_URL}/releases`

/** Where "Feedback" sends users: the fork's issue form picker. */
export const FORK_NEW_ISSUE_URL = `${FORK_REPO_URL}/issues/new/choose`
