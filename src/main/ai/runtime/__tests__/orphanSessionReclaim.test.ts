/**
 * Per-runtime reclamation of orphaned session state, driven by the resume-token
 * keep-set the agent orphan sweep reads from the database.
 *
 * Each layout below is taken from the runtime that owns it, not guessed:
 *  - claude — the Agent SDK's `deleteSession` removes `{id}.jsonl` plus the
 *            `{id}/` subagent-transcript directory from the projects dir
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { application } from '@application'

import { registerRuntimeDrivers } from '../registerDrivers'
import { runtimeDriverRegistry } from '../registry'

const NOW = 1_800_000_000_000
const FRESHNESS_GATE_MS = 5 * 60 * 1000
const OPTIONS = { freshnessGateMs: FRESHNESS_GATE_MS, now: NOW }
/** Older than the freshness gate, so the sweep is allowed to act. */
const STALE_SECONDS = (NOW - 60 * 60 * 1000) / 1000

let root: string

function seedFile(relativePath: string, mtimeSeconds = STALE_SECONDS): string {
  const target = path.join(root, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, 'x')
  utimesSync(target, mtimeSeconds, mtimeSeconds)
  return target
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cs-runtime-reclaim-'))
  ;(application.getPath as Mock).mockImplementation((key: string) => path.join(root, key))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.mocked(application.getPath as Mock).mockReset()
})

describe('claude-code reclaimOrphanSessions', () => {
  const projects = 'feature.agents.claude.projects'

  function claudeDriver() {
    runtimeDriverRegistry.clearForTest()
    registerRuntimeDrivers()
    const driver = runtimeDriverRegistry.getAgentSessionDriver('claude-code')
    if (!driver?.reclaimOrphanSessions) throw new Error('claude-code driver missing reclaimOrphanSessions')
    return driver
  }

  afterEach(() => runtimeDriverRegistry.clearForTest())

  it('removes an unclaimed transcript with its subagent directory, keeping claimed ones', async () => {
    const orphan = seedFile(`${projects}/-tmp-work/gone-id.jsonl`)
    const orphanSubagents = seedFile(`${projects}/-tmp-work/gone-id/agent-1.jsonl`)
    const claimed = seedFile(`${projects}/-tmp-work/live-id.jsonl`)

    const { removed } = await claudeDriver().reclaimOrphanSessions!(new Set(['live-id']), OPTIONS)

    expect(removed).toEqual([orphan, path.join(root, projects, '-tmp-work', 'gone-id')])
    expect(existsSync(orphanSubagents)).toBe(false)
    expect(existsSync(claimed)).toBe(true)
  })

  it("never leaves Cherry's own projects dir", async () => {
    // The Claude-login provider writes into the user's real ~/.claude by design
    // (settingsBuilder deletes CLAUDE_CONFIG_DIR for it), so that corpus is shared
    // with the user's terminal sessions and must stay untouched.
    const userHome = seedFile('sys.home/.claude/projects/-tmp-work/personal-id.jsonl')
    seedFile(`${projects}/-tmp-work/gone-id.jsonl`)

    await claudeDriver().reclaimOrphanSessions!(new Set(), OPTIONS)

    expect(existsSync(userHome)).toBe(true)
  })

  it('no-ops when the runtime was never used', async () => {
    await expect(claudeDriver().reclaimOrphanSessions!(new Set(), OPTIONS)).resolves.toEqual({ removed: [] })
  })
})
