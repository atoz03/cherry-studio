---
description: Fork runbook for tagging atoz03/cherry-studio releases and publishing them to its GitHub Releases update feed
sources:
  - .github/workflows/release.yml
  - electron-builder.yml
  - src/main/services/forkUpdateFeed.ts
  - src/main/data/migration/v2/core/versionPolicy.ts
  - src/main/services/AppUpdaterService.ts
  - dev-app-update.yml
---

# Release Workflow Operations

This fork (`atoz03/cherry-studio`) is developed independently of upstream and does not use upstream's release branches, nightly, preview, backport, or post-release workflows. A release is a version tag on `main`, built by [`release.yml`](../../.github/workflows/release.yml) and published to this repository's GitHub Releases, which is also the auto-update feed.

## Versions

Fork versions are plain semver, numbered independently of upstream from `3.0.0` (the fork branched from upstream `v2.1.8`). Publish them as regular releases, never prereleases: the updater only offers the release marked latest.

Stay on 3.x while the app still migrates v1 data: [`versionPolicy.ts`](../../src/main/data/migration/v2/core/versionPolicy.ts) blocks a first migration from v1 into 4.0.0 or later.

## Publish a release

1. On `main`, set `version` in `package.json` and commit it (`chore(release): v3.0.1`, `--signoff`).
2. Tag and push: `git tag v3.0.1 && git push origin main v3.0.1`.
3. `release.yml` builds macOS, Windows, and Linux with `--publish never`. Each platform uploads its installers, `latest*.yml` manifests, and blockmaps as a build artifact.
4. The `publish` job runs only after every platform succeeded. It creates the GitHub Release for the tag, marks it latest, and attaches all files. The release body is what the in-app update dialog shows as release notes, so edit it on GitHub after publishing.

To rebuild one platform, run the workflow manually with the tag and platform. The publish job then replaces that platform's files on the existing release.

## Signing

- **macOS** is signed and notarized only when all of `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set as repository secrets; otherwise the build is unsigned. macOS only installs auto-updates into a signed app, so unsigned builds must be updated by downloading the new DMG.
- **Windows** builds are unsigned, so SmartScreen warns on first install.

## How clients find updates

electron-builder writes the `publish` section of `electron-builder.yml` (GitHub, `atoz03/cherry-studio`) into the packaged `app-update.yml`. On each check, [`forkUpdateFeed.ts`](../../src/main/services/forkUpdateFeed.ts) makes electron-updater read the release marked latest, never offer an older version, and send no identifying headers. Only the global edition is built; a China-edition build would look for `latest-cn*.yml`, which this workflow does not produce.

Packaged, non-portable builds check every 4 hours and back off exponentially after failed scheduled checks; manual checks are also available in development. Portable Windows builds never check. Development builds read [`dev-app-update.yml`](../../dev-app-update.yml), which points at the same GitHub Releases and documents how to switch to a local generic server.

Windows NSIS builds also produce differential packages and `.blockmap` files, which the workflow attaches to the release. electron-updater uses them to download only the changed ranges, and falls back to a full download when a blockmap or cached base package is missing.
