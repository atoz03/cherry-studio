import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'

import type { MigrationContext } from '../../core/MigrationContext'
import { DexieSettingsReader } from '../../utils/DexieSettingsReader'
import { LocalStorageReader } from '../../utils/LocalStorageReader'
import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { PreferencesMigrator } from '../PreferencesMigrator'

const ENABLED = 'feature.notes.git.enabled'
const INTERVAL = 'feature.notes.git.commit_interval_minutes'

function contextWithNoteState(note: Record<string, unknown> | undefined, db: unknown): MigrationContext {
  return {
    sources: {
      electronStore: { get: () => undefined },
      reduxState: new ReduxStateReader(note ? { note } : {}),
      dexieExport: {
        readTable: async () => [],
        createStreamReader: async () => null,
        tableExists: async () => false
      },
      dexieSettings: new DexieSettingsReader([]),
      localStorage: new LocalStorageReader([]),
      knowledgeVectorSource: { hasSource: () => false },
      legacyHomeConfig: { exists: () => false, read: () => null }
    },
    db,
    sharedData: new Map<string, unknown>(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    paths: {}
  } as unknown as MigrationContext
}

describe('PreferencesMigrator — v1 fork notes git settings', () => {
  const dbh = setupTestDatabase()

  const migrate = async (note: Record<string, unknown> | undefined) => {
    const migrator = new PreferencesMigrator()
    const ctx = contextWithNoteState(note, dbh.db)
    await migrator.prepare(ctx)
    await migrator.execute(ctx)
  }

  const valueOf = async (key: string) => {
    const rows = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
    return rows[0]?.value
  }

  it('keeps a v1 user who had git versioning on, with their interval', async () => {
    await migrate({ settings: { enableGit: true, gitCommitIntervalMinutes: 30 } })

    expect(await valueOf(ENABLED)).toBe(true)
    expect(await valueOf(INTERVAL)).toBe(30)
  })

  it('keeps git versioning off for a v1 user who turned it off', async () => {
    await migrate({ settings: { enableGit: false, gitCommitIntervalMinutes: 5 } })

    expect(await valueOf(ENABLED)).toBe(false)
  })

  // No stored row means the generated v2 default applies at read time.
  it('stores nothing for values v1 could not have written', async () => {
    await migrate({ settings: { enableGit: 'yes', gitCommitIntervalMinutes: 7 } })

    expect(await valueOf(ENABLED)).toBeUndefined()
    expect(await valueOf(INTERVAL)).toBeUndefined()
  })

  it('stores nothing when the v1 state has no notes git settings', async () => {
    await migrate(undefined)

    expect(await valueOf(ENABLED)).toBeUndefined()
    expect(await valueOf(INTERVAL)).toBeUndefined()
  })
})
