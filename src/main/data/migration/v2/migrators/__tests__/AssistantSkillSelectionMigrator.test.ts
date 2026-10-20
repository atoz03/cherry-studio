import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { assistantTable } from '@data/db/schemas/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import type { MigrationContext } from '../../core/MigrationContext'
import {
  AssistantSkillSelectionMigrator,
  collectLegacySkillSelections,
  type InstalledSkillRef,
  matchLegacySkills
} from '../AssistantSkillSelectionMigrator'
import { getAllMigrators } from '../migratorRegistry'

const PDF_ID = '11111111-1111-4111-8111-111111111111'
const REVIEW_ID = '22222222-2222-4222-8222-222222222222'
const BROWSER_ID = '33333333-3333-4333-8333-333333333333'
const TWIN_A_ID = '44444444-4444-4444-8444-444444444444'
const TWIN_B_ID = '55555555-5555-4555-8555-555555555555'

const INSTALLED: InstalledSkillRef[] = [
  { id: PDF_ID, name: 'PDF Tools', folderName: 'pdf-tools', source: 'marketplace' },
  { id: REVIEW_ID, name: 'Code Review', folderName: 'Code-Review', source: 'local' },
  { id: BROWSER_ID, name: 'Browser', folderName: 'cherry-browser', source: 'builtin' },
  { id: TWIN_A_ID, name: 'Twin', folderName: 'twin-a', source: 'local' },
  { id: TWIN_B_ID, name: 'Twin', folderName: 'twin-b', source: 'local' }
]

function createMigrationContext(assistantState: unknown, db: MigrationContext['db']): MigrationContext {
  return {
    sources: {
      reduxState: {
        getCategory: vi.fn((category: string) => (category === 'assistants' ? assistantState : undefined))
      } as unknown as MigrationContext['sources']['reduxState']
    } as MigrationContext['sources'],
    db,
    sharedData: new Map(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as MigrationContext['logger'],
    paths: {} as MigrationContext['paths']
  }
}

describe('matchLegacySkills', () => {
  it('matches v1 folder names, v2 ids, case variants and unique skill names, keeping order without duplicates', () => {
    expect(matchLegacySkills(['code-review', 'pdf-tools', PDF_ID, 'pdf tools '], INSTALLED)).toEqual({
      skillIds: [REVIEW_ID, PDF_ID],
      unmatched: []
    })
  })

  it('reports values that are unknown, built-in, or ambiguous instead of guessing', () => {
    expect(matchLegacySkills(['gone-skill', 'cherry-browser', 'twin', 'twin-b'], INSTALLED)).toEqual({
      skillIds: [TWIN_B_ID],
      unmatched: ['gone-skill', 'cherry-browser', 'twin']
    })
  })
})

describe('collectLegacySkillSelections', () => {
  it('keys selections by v2 assistant id and lets the live copy win over the default slot', () => {
    const selections = collectLegacySkillSelections(
      {
        assistants: [
          { id: 'default', enabledSkills: ['pdf-tools'] },
          { id: 'writer', enabledSkills: [] },
          { id: 'coder', enabledSkills: ['code-review', 42, ' '] }
        ],
        presets: [{ id: 'preset-1', enabledSkills: ['pdf-tools'] }],
        defaultAssistant: { id: 'default', enabledSkills: ['code-review'] }
      },
      new Map([['default', 'uuid-default']])
    )

    expect([...selections]).toEqual([
      ['uuid-default', ['pdf-tools']],
      ['coder', ['code-review']],
      ['preset-1', ['pdf-tools']]
    ])
  })

  it('tolerates a missing or malformed assistants slice', () => {
    expect(collectLegacySkillSelections(undefined, new Map()).size).toBe(0)
    expect(collectLegacySkillSelections({ assistants: 'nope', defaultAssistant: null }, new Map()).size).toBe(0)
  })
})

describe('AssistantSkillSelectionMigrator', () => {
  const dbh = setupTestDatabase()
  const ASSISTANT_ID = '66666666-6666-4666-8666-666666666666'
  const DEFAULT_UUID = '77777777-7777-4777-8777-777777777777'
  const UNMATCHED_ASSISTANT_ID = '88888888-8888-4888-8888-888888888888'

  async function seed() {
    await dbh.db
      .insert(agentGlobalSkillTable)
      .values(INSTALLED.map((skill) => ({ ...skill, description: null, contentHash: skill.id, isEnabled: true })))
    await dbh.db.insert(assistantTable).values(
      [ASSISTANT_ID, DEFAULT_UUID, UNMATCHED_ASSISTANT_ID].map((id, index) => ({
        id,
        name: `Assistant ${index}`,
        emoji: '🌟',
        settings: { ...DEFAULT_ASSISTANT_SETTINGS, temperature: 0.4 },
        orderKey: `a${index}`
      }))
    )
  }

  function settingsOf(id: string) {
    return dbh.db.select().from(assistantTable).where(eq(assistantTable.id, id)).get()!.settings
  }

  it('writes the mapped selection into each migrated assistant and skips what cannot be mapped', async () => {
    await seed()
    const ctx = createMigrationContext(
      {
        assistants: [
          { id: ASSISTANT_ID, enabledSkills: ['Code-Review', 'missing-skill', 'pdf-tools'] },
          { id: UNMATCHED_ASSISTANT_ID, enabledSkills: ['cherry-browser'] },
          { id: 'not-migrated', enabledSkills: ['pdf-tools'] }
        ],
        defaultAssistant: { id: 'default', enabledSkills: ['pdf-tools'] }
      },
      dbh.db
    )
    ctx.sharedData.set('legacyAssistantIdRemap', new Map([['default', DEFAULT_UUID]]))
    const migrator = new AssistantSkillSelectionMigrator()

    const prepared = await migrator.prepare(ctx)
    const executed = await migrator.execute(ctx)
    const validated = await migrator.validate(ctx)

    expect(prepared).toMatchObject({ success: true, itemCount: 3 })
    expect(prepared.warnings?.join('\n')).toContain('missing-skill')
    expect(prepared.warnings?.join('\n')).toContain('cherry-browser')
    expect(executed).toMatchObject({ success: true, processedCount: 2 })
    expect(executed.warnings?.join('\n')).toContain('not-migrated')
    expect(validated).toMatchObject({
      success: true,
      stats: { sourceCount: 4, targetCount: 2, skippedCount: 2 }
    })
    expect(settingsOf(ASSISTANT_ID)).toMatchObject({ temperature: 0.4, contextSkillIds: [REVIEW_ID, PDF_ID] })
    expect(settingsOf(DEFAULT_UUID).contextSkillIds).toEqual([PDF_ID])
    expect(settingsOf(UNMATCHED_ASSISTANT_ID).contextSkillIds).toBeUndefined()
  })

  it('is a no-op when no v1 assistant carried a skill selection', async () => {
    const ctx = createMigrationContext({ assistants: [{ id: ASSISTANT_ID }] }, dbh.db)
    const migrator = new AssistantSkillSelectionMigrator()

    await expect(migrator.prepare(ctx)).resolves.toMatchObject({ success: true, itemCount: 0 })
    await expect(migrator.execute(ctx)).resolves.toMatchObject({ success: true, processedCount: 0 })
    await expect(migrator.validate(ctx)).resolves.toMatchObject({
      success: true,
      stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
    })
  })

  it('runs after the migrators that create assistants and installed skills', () => {
    const migrators = getAllMigrators()
    const order = (id: string) => migrators.find((migrator) => migrator.id === id)!.order
    expect(order('assistant_skill_selection')).toBeGreaterThan(order('assistant'))
    expect(order('assistant_skill_selection')).toBeGreaterThan(order('agents'))
  })
})
