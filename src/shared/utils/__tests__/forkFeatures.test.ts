import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse, parseAllDocuments } from 'yaml'

import * as forkFeatureModule from '../forkFeatures'

type ForkSwitch = Exclude<keyof typeof forkFeatureModule, 'FORK_DATA_COLLECTION_ENABLED'>
const forkFeatures: Record<ForkSwitch, boolean> = { ...forkFeatureModule }

interface FeaturePackages {
  /** Production dependencies (package.json `dependencies`/`optionalDependencies`) only this feature uses. */
  readonly roots: readonly string[]
  /**
   * `node_modules` names negated in electron-builder.yml as `!**\/node_modules/<name>/**` while the
   * switch is off; a bare `@scope` covers the whole scope.
   */
  readonly excluded: readonly string[]
}

/**
 * What each switch keeps out of the installer. Adding a switch to forkFeatures.ts without an entry
 * here is a type error; a feature whose code is bundled (devDependencies) has nothing to exclude.
 */
const FEATURE_PACKAGES: Record<ForkSwitch, FeaturePackages> = {
  FORK_REMOTE_ACCESS_ENABLED: {
    roots: ['@cherrystudio/remote-transport'],
    excluded: [
      '@cherrystudio/remote-transport',
      '@libp2p',
      '@chainsafe',
      '@multiformats',
      '@noble',
      'multiformats',
      'uint8arrays',
      'uint8arraylist',
      'protons-runtime',
      'cborg',
      'abort-error',
      'any-signal',
      'delay',
      '@dnsquery/dns-packet',
      'eventemitter3',
      'hashlru',
      'interface-datastore',
      'interface-store',
      'is-electron',
      'is-loopback-addr',
      'it-length-prefixed',
      'it-merge',
      'it-pipe',
      'it-pushable',
      'it-queueless-pushable',
      'it-reader',
      'it-stream-types',
      'json-rpc-2.0',
      '@leichtgewicht/ip-codec',
      'main-event',
      'netmask',
      'p-defer',
      'p-event',
      'p-queue',
      'p-timeout',
      'progress-events',
      'race-signal',
      'random-int',
      '@sindresorhus/fnv1a',
      'uint8-varint',
      'unlimited-timeout',
      'utf8-codec',
      'weald',
      'wherearewe'
    ]
  },
  FORK_CHERRY_CLOUD_ENABLED: { roots: [], excluded: [] },
  FORK_DIAGNOSTICS_UPLOAD_ENABLED: { roots: [], excluded: [] },
  FORK_TEST_PLAN_ENABLED: { roots: [], excluded: [] }
}

type DependencyEntry = readonly [name: string, version: string, importer: string]
type DependencyVersions = Record<string, string>
interface Lockfile {
  importers: Record<
    string,
    Partial<Record<'dependencies' | 'optionalDependencies', Record<string, { version: string }>>>
  >
  snapshots: Record<string, Partial<Record<'dependencies' | 'optionalDependencies', DependencyVersions>> | null>
}

const projectRoot = process.cwd()
const readProjectFile = (file: string) => readFileSync(path.join(projectRoot, file), 'utf8')

const builderFiles = (parse(readProjectFile('electron-builder.yml')) as { files: string[] }).files
const packageJson = JSON.parse(readProjectFile('package.json')) as Record<
  'dependencies' | 'optionalDependencies',
  Record<string, string> | undefined
>
// pnpm writes its own config/package-manager lockfile as a separate YAML document ahead of the project's.
const lockfile = parseAllDocuments(readProjectFile('pnpm-lock.yaml'))
  .map((document) => document.toJS() as Partial<Lockfile> | null)
  .find((document): document is Lockfile => Boolean(document?.importers?.['.']?.dependencies))!

const switches = Object.keys(FEATURE_PACKAGES) as ForkSwitch[]
const disabledSwitches = switches.filter((name) => !forkFeatures[name])
const exclusionPattern = (name: string) => `!**/node_modules/${name}/**`
const covers = (entry: string, name: string) =>
  name === entry || (entry.startsWith('@') && !entry.includes('/') && name.startsWith(`${entry}/`))

function importerDependencies(importer: string): DependencyEntry[] {
  const { dependencies = {}, optionalDependencies = {} } = lockfile.importers[importer] ?? {}
  return Object.entries({ ...dependencies, ...optionalDependencies }).map(([name, { version }]) => [
    name,
    version,
    importer
  ])
}

/** `node_modules` names a packaged app needs for these entries: their transitive production closure. */
function closure(entries: readonly DependencyEntry[]): Set<string> {
  const names = new Set<string>()
  const visited = new Set<string>()
  const pending = [...entries]
  for (let entry = pending.pop(); entry; entry = pending.pop()) {
    const [name, version, importer] = entry
    names.add(name)
    if (version.startsWith('link:')) {
      const workspacePackage = path.posix.join(importer, version.slice('link:'.length))
      if (!visited.has(workspacePackage)) pending.push(...importerDependencies(workspacePackage))
      visited.add(workspacePackage)
      continue
    }
    // Aliases (`npm:pkg@x`) are recorded by their target; everything else by `<name>@<version>`.
    const key = /^(\d|git\+|https?:|file:)/.test(version) ? `${name}@${version}` : version
    if (visited.has(key)) continue
    visited.add(key)
    if (!(key in lockfile.snapshots)) throw new Error(`pnpm-lock.yaml has no snapshot for ${key}`)
    const snapshot = lockfile.snapshots[key]
    for (const [dependency, dependencyVersion] of Object.entries({
      ...snapshot?.dependencies,
      ...snapshot?.optionalDependencies
    })) {
      pending.push([dependency, dependencyVersion, importer])
    }
  }
  return names
}

const productionRoots = importerDependencies('.').filter(
  ([name]) => name in (packageJson.dependencies ?? {}) || name in (packageJson.optionalDependencies ?? {})
)
const disabledRoots = new Set(disabledSwitches.flatMap((name) => FEATURE_PACKAGES[name].roots))
const shippedPackages = closure(productionRoots.filter(([name]) => !disabledRoots.has(name)))

describe('fork feature switches', () => {
  it('maps every switch to production dependencies that exist', () => {
    const productionNames = productionRoots.map(([name]) => name)
    for (const name of switches) {
      for (const root of FEATURE_PACKAGES[name].roots) expect(productionNames, name).toContain(root)
    }
  })

  it('excludes the packages of disabled features from the installer, and only those', () => {
    for (const name of switches) {
      for (const pattern of FEATURE_PACKAGES[name].excluded.map(exclusionPattern)) {
        if (forkFeatures[name]) expect(builderFiles, `${name} is on`).not.toContain(pattern)
        else expect(builderFiles, `${name} is off`).toContain(pattern)
      }
    }
  })

  it('excludes everything a disabled feature alone brings into the installer', () => {
    for (const name of disabledSwitches) {
      const { roots, excluded } = FEATURE_PACKAGES[name]
      const featureOnly = [...closure(productionRoots.filter(([root]) => roots.includes(root)))].filter(
        (dependency) => !shippedPackages.has(dependency)
      )
      const uncovered = featureOnly.filter((dependency) => !excluded.some((entry) => covers(entry, dependency)))
      expect(uncovered, `${name} leaves these in the installer`).toEqual([])
    }
  })

  it('never excludes a package the rest of the app still ships', () => {
    for (const name of disabledSwitches) {
      const broken = [...shippedPackages].filter((dependency) =>
        FEATURE_PACKAGES[name].excluded.some((entry) => covers(entry, dependency))
      )
      expect(broken, `${name} exclusions remove packages other code needs`).toEqual([])
    }
  })
})
