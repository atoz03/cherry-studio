import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'

import type { MigrationContext } from '../../core/MigrationContext'
import { AgentsMigrator } from '../AgentsMigrator'

// v1 rows corrupted into bare epoch strings (#17685) must not abort the migration.
type LegacyRow = { name: string; createdAt: string; updatedAt: string; deletedAt?: string }

const LEGACY_AGENTS: LegacyRow[] = [
  { name: 'epoch seconds', createdAt: '1712345678', updatedAt: '1712345679' },
  { name: 'epoch millis', createdAt: '1712345678901', updatedAt: '1712345678902' },
  { name: 'epoch millis with Z', createdAt: '1784810600097Z', updatedAt: ' 1784810600098z ' },
  { name: 'iso', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' },
  { name: 'iso offset', createdAt: '2026-07-20T08:00:00+08:00', updatedAt: '2026-07-21T08:00:00+08:00' },
  { name: 'garbage created', createdAt: 'not-a-date', updatedAt: '2026-07-21T00:00:00.000Z' },
  { name: 'both garbage', createdAt: 'not-a-date', updatedAt: '' },
  {
    name: 'garbage deleted',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    deletedAt: 'not-a-date'
  },
  { name: 'epoch deleted', createdAt: '1712345678', updatedAt: '1712345679', deletedAt: '1712345680Z' }
]

const LEGACY_SESSIONS: LegacyRow[] = [
  { name: 'garbage created session', createdAt: 'not-a-date', updatedAt: '1712345678901' },
  { name: 'epoch seconds session', createdAt: '1712345678', updatedAt: '2026-07-21T00:00:00.000Z' }
]

function seedLegacyAgentsDb(databasePath: string): void {
  const database = new Database(databasePath)
  try {
    database.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT,
        accessible_paths TEXT,
        mcps TEXT,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        accessible_paths TEXT,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        timeout_minutes INTEGER,
        status TEXT NOT NULL
      );

      CREATE TABLE channel_task_subscriptions (
        channel_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        PRIMARY KEY (channel_id, task_id)
      );
    `)

    const insertAgent = database.prepare(
      `INSERT INTO agents (id, type, name, instructions, mcps, sort_order, created_at, updated_at, deleted_at)
       VALUES (?, 'claude_code', ?, 'instructions', '[]', ?, ?, ?, ?)`
    )
    LEGACY_AGENTS.forEach((row, index) =>
      insertAgent.run(`agent_${index}`, row.name, index, row.createdAt, row.updatedAt, row.deletedAt ?? null)
    )

    const insertSession = database.prepare(
      `INSERT INTO sessions (id, agent_id, name, sort_order, created_at, updated_at) VALUES (?, 'agent_0', ?, ?, ?, ?)`
    )
    LEGACY_SESSIONS.forEach((row, index) =>
      insertSession.run(`session_${index}`, row.name, index, row.createdAt, row.updatedAt)
    )
  } finally {
    database.close()
  }
}

describe('AgentsMigrator legacy timestamp repair', () => {
  const dbh = setupTestDatabase()
  let tempRoot: string | undefined

  afterEach(async () => {
    dbh.sqlite.pragma('foreign_keys = ON')
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  })

  it('migrates epoch-string, ISO and unparseable timestamps instead of failing the import', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-migrator-timestamps-'))
    const dataDir = path.join(tempRoot, 'Data')
    const agentsDataDir = path.join(dataDir, 'Agents')
    const legacyClaudeConfigDir = path.join(tempRoot, '.claude')
    await mkdir(dataDir, { recursive: true })
    const legacyAgentDbFile = path.join(dataDir, 'agents.db')
    seedLegacyAgentsDb(legacyAgentDbFile)

    const context = {
      db: dbh.db,
      sharedData: new Map(),
      paths: {
        legacyAgentDbFile,
        legacyClaudeConfigDir,
        legacyClaudeProjectsDir: path.join(legacyClaudeConfigDir, 'projects'),
        claudeConfigDir: path.join(agentsDataDir, '.claude'),
        claudeProjectsDir: path.join(agentsDataDir, '.claude', 'projects'),
        agentsDataDir,
        agentSystemWorkspacesDir: path.join(agentsDataDir, 'system'),
        filesDataDir: path.join(dataDir, 'Files')
      }
    } as unknown as MigrationContext

    // MigrationDbService runs the whole migration with foreign keys off.
    dbh.sqlite.pragma('foreign_keys = OFF')
    const migrator = new AgentsMigrator()
    const startedAtMs = Date.now()
    await migrator.prepare(context)
    const executeResult = await migrator.execute(context)
    const validateResult = await migrator.validate(context)
    const finishedAtMs = Date.now()

    expect(executeResult.success).toBe(true)
    expect(validateResult).toMatchObject({ success: true, errors: [] })

    const agents = new Map(
      dbh.db
        .select()
        .from(agentTable)
        .all()
        .map((agent) => [agent.name, agent])
    )
    const agentTimes = (name: string) => {
      const agent = agents.get(name)!
      return { createdAt: agent.createdAt, updatedAt: agent.updatedAt, deletedAt: agent.deletedAt }
    }
    expect(agents.size).toBe(LEGACY_AGENTS.length)
    expect(agentTimes('epoch seconds')).toEqual({ createdAt: 1712345678000, updatedAt: 1712345679000, deletedAt: null })
    expect(agentTimes('epoch millis')).toEqual({ createdAt: 1712345678901, updatedAt: 1712345678902, deletedAt: null })
    expect(agentTimes('epoch millis with Z')).toEqual({
      createdAt: 1784810600097,
      updatedAt: 1784810600098,
      deletedAt: null
    })
    expect(agentTimes('iso')).toEqual({
      createdAt: Date.parse('2026-07-20T00:00:00.000Z'),
      updatedAt: Date.parse('2026-07-21T00:00:00.000Z'),
      deletedAt: null
    })
    expect(agentTimes('iso offset')).toEqual({
      createdAt: Date.parse('2026-07-20T00:00:00.000Z'),
      updatedAt: Date.parse('2026-07-21T00:00:00.000Z'),
      deletedAt: null
    })
    expect(agentTimes('garbage created')).toEqual({
      createdAt: Date.parse('2026-07-21T00:00:00.000Z'),
      updatedAt: Date.parse('2026-07-21T00:00:00.000Z'),
      deletedAt: null
    })
    // A soft-deleted agent stays deleted; an unparseable deletion time falls back to updated_at.
    expect(agentTimes('garbage deleted')).toEqual({
      createdAt: Date.parse('2026-07-20T00:00:00.000Z'),
      updatedAt: Date.parse('2026-07-22T00:00:00.000Z'),
      deletedAt: Date.parse('2026-07-22T00:00:00.000Z')
    })
    expect(agentTimes('epoch deleted')).toEqual({
      createdAt: 1712345678000,
      updatedAt: 1712345679000,
      deletedAt: 1712345680000
    })

    // Both unparseable: migration time, at SQLite's whole-second resolution.
    const bothGarbage = agentTimes('both garbage')
    expect(bothGarbage.createdAt).toBe(bothGarbage.updatedAt)
    expect(bothGarbage.createdAt).toBeGreaterThanOrEqual(Math.floor(startedAtMs / 1000) * 1000)
    expect(bothGarbage.createdAt).toBeLessThanOrEqual(finishedAtMs)

    const sessions = new Map(
      dbh.db
        .select()
        .from(agentSessionTable)
        .all()
        .map((session) => [session.name, session])
    )
    const sessionTimes = (name: string) => {
      const session = sessions.get(name)!
      return { createdAt: session.createdAt, updatedAt: session.updatedAt, lastActivityAt: session.lastActivityAt }
    }
    expect(sessionTimes('garbage created session')).toEqual({
      createdAt: 1712345678901,
      updatedAt: 1712345678901,
      lastActivityAt: 1712345678901
    })
    expect(sessionTimes('epoch seconds session')).toEqual({
      createdAt: 1712345678000,
      updatedAt: Date.parse('2026-07-21T00:00:00.000Z'),
      lastActivityAt: 1712345678000
    })
  })
})
