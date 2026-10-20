---
description: Fork runbook for tagging atoz03/cherry-studio releases and publishing them to its GitHub Releases update feed
sources:
  - .github/workflows/release.yml
  - electron-builder.yml
  - src/main/services/forkUpdateFeed.ts
  - .agents/skills/sync-upstream/SKILL.md
---

# Release Workflow Operations

This fork (`atoz03/cherry-studio`) does not use upstream's release branches, nightly, preview, backport, or post-release workflows. A release is a version tag on `main`, built by [`release.yml`](../../.github/workflows/release.yml) and published to this repository's GitHub Releases, which is also the auto-update feed.

## Versions

Fork versions are `<upstream release>-atoz.<n>`, for example `2.1.8-atoz.1`: the upstream tag the fork is based on, plus a fork counter that restarts at `1` after each upstream sync (see the [`sync-upstream`](../../.agents/skills/sync-upstream/SKILL.md) skill). Semver orders them as the updater needs: `2.1.8-atoz.1 < 2.1.8-atoz.2 < 2.1.9-atoz.1`.

## Publish a release

1. On `main`, set `version` in `package.json` and commit it (`chore(release): v2.1.8-atoz.2`, `--signoff`).
2. Tag and push: `git tag v2.1.8-atoz.2 && git push origin main v2.1.8-atoz.2`.
3. `release.yml` builds macOS, Windows, and Linux with `--publish never`. Each platform uploads its installers, `latest*.yml` manifests, and blockmaps as a build artifact.
4. The `publish` job runs only after every platform succeeded. It creates the GitHub Release for the tag, marks it latest, and attaches all files. The release body is what the in-app update dialog shows as release notes, so edit it on GitHub after publishing.

To rebuild one platform, run the workflow manually with the tag and platform. The publish job then replaces that platform's files on the existing release.

## Signing

- **macOS** is signed and notarized only when all of `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set as repository secrets; otherwise the build is unsigned. macOS only installs auto-updates into a signed app, so unsigned builds must be updated by downloading the new DMG.
- **Windows** builds are unsigned, so SmartScreen warns on first install.

## How clients find updates

electron-builder writes the `publish` section of `electron-builder.yml` (GitHub, `atoz03/cherry-studio`) into the packaged `app-update.yml`. On each check, [`forkUpdateFeed.ts`](../../src/main/services/forkUpdateFeed.ts) makes electron-updater read the release marked latest, never offer an older version, and send no identifying headers. Only the global edition is built; a China-edition build would look for `latest-cn*.yml`, which this workflow does not produce.
