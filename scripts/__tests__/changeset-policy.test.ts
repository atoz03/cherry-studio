import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const script = path.resolve(import.meta.dirname, '../release/check-changesets.mjs')
let root: string

function write(file: string, content: string) {
  const target = path.join(root, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function configure(ignore = ['@cherrystudio/ui']) {
  write('.changeset/config.json', JSON.stringify({ ignore }))
}

function check() {
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'changeset-policy-'))
  write('package.json', JSON.stringify({ name: 'fixture', private: true }))
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  for (const name of ['ui', 'web-search']) {
    write(`packages/${name}/package.json`, JSON.stringify({ name: `@cherrystudio/${name}`, version: '1.0.0' }))
  }
  configure()
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('changeset release policy', () => {
  it('rejects the ignored-only changeset that otherwise survives every version PR', () => {
    write('.changeset/voice-content-consumers.md', "---\n'@cherrystudio/ui': patch\n---\n\nVoice controls.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.changeset/voice-content-consumers.md')
    expect(result.stderr).toContain('ignored packages: @cherrystudio/ui')
  })

  it('rejects ignored changesets even when another file contains a real release', () => {
    write('.changeset/ignored.md', "---\n'@cherrystudio/ui': patch\n---\n\nUI.\n")
    write('.changeset/publish.md', "---\n'@cherrystudio/web-search': minor\n---\n\nSearch.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.changeset/ignored.md references ignored packages: @cherrystudio/ui')
  })

  it('rejects a changeset mixing ignored and published packages', () => {
    write('.changeset/mixed.md', "---\n'@cherrystudio/ui': patch\n'@cherrystudio/web-search': patch\n---\n\nUpdate.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.changeset/mixed.md references ignored packages: @cherrystudio/ui')
  })

  it('uses Changesets ignore glob semantics', () => {
    configure(['@cherrystudio/*'])
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ignored packages: @cherrystudio/web-search')
  })

  it('accepts a publishable changeset', () => {
    write('.changeset/search.md', "---\n'@cherrystudio/web-search': patch\n---\n\nSearch.\n")

    expect(check().status).toBe(0)
  })

  it('allows intentionally empty changesets for changes needing no release', () => {
    write('.changeset/no-release.md', '---\n---\n')

    expect(check().status).toBe(0)
  })

  it('allows the consumed state so the action can enter npm publication', () => {
    write('.changeset/README.md', '# Changesets\n')

    expect(check().status).toBe(0)
  })

  it('fails closed on invalid Changesets configuration', () => {
    write('.changeset/config.json', JSON.stringify({ ignore: true }))

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ignore')
  })

  it('rejects malformed changesets instead of silently treating them as empty', () => {
    write('.changeset/broken.md', 'Missing frontmatter\n')

    const result = check()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('could not parse changeset')
  })

  // The fork publishes no packages, so CI is the only workflow that runs the policy.
  it('gates CI on the changeset policy', () => {
    const repo = path.resolve(import.meta.dirname, '../..')
    const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
    expect(manifest.scripts['changeset:check']).toBe('node scripts/release/check-changesets.mjs')

    const workflow = parse(readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8'))
    const guard = workflow.jobs['basic-checks'].steps.find(
      (step: { run?: string }) => step.run === 'pnpm changeset:check'
    )
    expect(guard).toBeDefined()
    expect(guard['continue-on-error']).toBeUndefined()
    expect(guard.if).toBe("needs.changes.outputs.repository == 'true'")
  })
})
