---
name: sync-upstream
description: Sync this fork with a new upstream CherryHQ/cherry-studio release tag. Use when asked to sync, merge, or update from upstream, "merge origin main", "sync fork main", or bump to a newer upstream v2 release.
---

# Sync the fork with an upstream release

The fork tracks upstream **release tags**, not `upstream/main`. Each sync is one merge commit of a tag (for example `v2.1.9`) on a short-lived branch, fast-forwarded into `main` after verification. See the Fork Rules at the end of `CLAUDE.md`.

## 1. Prepare

```bash
git status --short                       # must be clean
git fetch upstream --tags --prune
git tag -l 'v2.*' --sort=-v:refname | head -5
git describe --tags --abbrev=0 --match 'v2.*' HEAD   # tag currently merged
```

Pick the newest stable tag (no `-alpha`/`-beta`/`-rc` suffix) unless the user names one. Release tags sit on `release/v2.x.y` branches: upstream `main` at some commit plus one "prepare release" commit.

## 2. Merge on a branch

```bash
git switch -c sync/v2.x.y main
git merge --no-ff --signoff v2.x.y -m "chore(fork): sync upstream v2.x.y"
```

Resolve conflicts with these rules:

| Conflict | Resolution |
| --- | --- |
| `.github/workflows/*` other than the kept set in Fork Rules | delete the file (`git rm`) |
| `.github/workflows/ci.yml` | take upstream, then remove the `basic-checks` and `notify` jobs again |
| `.github/workflows/release.yml` | keep the fork's version |
| `package.json` `version`, `electron-builder.yml` `releaseInfo` | keep the fork's version string; take upstream's release notes |
| `pnpm-lock.yaml` | take upstream's, then `CI=1 pnpm install` and commit the regenerated lockfile if it changes |
| Generated preference / boot-config files | merge `scripts/data-classify/data/*.json`, then `pnpm data:generate` |
| `migrations/sqlite-drizzle/**` | always take upstream's (the fork never adds migrations) |
| `CLAUDE.md` | take upstream's body, keep the `## Fork Rules` section at the end |
| A file the fork gates with `forkFeatures.ts` | take upstream's change, then re-apply the one- or two-line gate |
| Anything else | understand both sides; keep the fork's behaviour only where a Fork Rule requires it |

After resolving, search for upstream additions that break Fork Rules — new boot-time warmups, timers, downloads, telemetry endpoints, or workflows:

```bash
git diff --stat main...v2.x.y -- src/main/core/application/serviceRegistry.ts src/main/core/window/windowRegistry.ts .github/workflows
git diff main...v2.x.y | grep -nE "warmup: 'eager'|registerInterval\(|setInterval\(|SENTRY|sentry|analytics" | head -50
```

Report anything found to the user before deciding.

## 3. Verify

```bash
CI=1 pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec vitest run src/shared/utils/__tests__/forkFeatures.test.ts
pnpm build:unpack   # optional, slow
```

Run the targeted tests for every file where you re-applied a fork change. Check that `pnpm db:migrations:check` passes.

## 4. Land

Only after the user approves:

```bash
git switch main && git merge --ff-only sync/v2.x.y
git branch -d sync/v2.x.y
```

Push (`git push origin main`) only when the user explicitly asks.
