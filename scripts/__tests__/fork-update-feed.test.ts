import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import createChinaEditionConfig from '../../electron-builder.cn.config.cjs'
import { FORK_RELEASE_OWNER, FORK_RELEASE_REPO } from '../../src/shared/utils/forkRelease'

const projectRoot = path.join(import.meta.dirname, '..', '..')
const readProjectFile = (file: string) => readFileSync(path.join(projectRoot, file), 'utf8')

const forkFeed = { provider: 'github', owner: FORK_RELEASE_OWNER, repo: FORK_RELEASE_REPO }
const UPSTREAM_UPDATE_HOSTS = /cherry-ai\.com|gitcode/i

type WorkflowStep = { name?: string; run?: string; with?: Record<string, string> }

describe('fork update feed', () => {
  it('writes the fork GitHub Releases into the global edition app-update.yml', () => {
    expect(parse(readProjectFile('electron-builder.yml')).publish).toEqual(forkFeed)
  })

  it('keeps the China edition on the same releases under its own manifest channel', async () => {
    const config = await createChinaEditionConfig()

    expect(config.publish).toEqual({ ...forkFeed, channel: 'latest-cn' })
  })

  it('checks the same feed in development', () => {
    expect(parse(readProjectFile('dev-app-update.yml'))).toEqual(forkFeed)
  })

  it.each(['electron-builder.yml', 'electron-builder.cn.config.cjs', 'dev-app-update.yml'])(
    'names no upstream update host in %s',
    (file) => {
      expect(readProjectFile(file)).not.toMatch(UPSTREAM_UPDATE_HOSTS)
    }
  )

  it('uploads the manifests the updater reads and leaves uploading to the release step', () => {
    const workflow = parse(readProjectFile('.github/workflows/release.yml'))
    const steps: WorkflowStep[] = workflow.jobs.release.steps
    const builds = steps.filter((step) => step.name?.startsWith('Build ') && step.run?.includes('pnpm build:'))
    const release = steps.find((step) => step.name === 'Release')

    expect(builds).toHaveLength(3)
    for (const build of builds) expect(build.run).toMatch(/pnpm build:\w+ --publish never/)
    expect(release?.with?.artifacts.split(',')).toEqual(expect.arrayContaining(['dist/latest*.yml', 'dist/*.blockmap']))
    expect(release?.with).toMatchObject({ draft: false, prerelease: false, makeLatest: true })
  })
})
