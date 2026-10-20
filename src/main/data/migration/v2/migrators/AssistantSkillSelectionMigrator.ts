/**
 * Fork: migrates the v1 fork's per-assistant skill selection.
 *
 * Source: Redux `assistants.assistants[] / presets[] / defaultAssistant` `.enabledSkills` (skill folder names)
 * Target: `assistant.settings.contextSkillIds` (installed-skill ids, see `@shared/ai/contextSkills`)
 *
 * Runs after AssistantMigrator (assistant rows and the 'default' → uuid remap) and AgentsMigrator
 * (v1 agents.db `skills` → `agent_global_skill`, ids and folder names preserved). Each legacy value
 * is matched to an installed skill by id, then folder name, then case-insensitive folder name or
 * skill name. Values that match nothing, match ambiguously, or match a built-in skill are skipped
 * with a warning.
 */

import { eq, inArray } from 'drizzle-orm'

import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { assistantTable } from '@data/db/schemas/assistant'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('AssistantSkillSelectionMigrator')

interface LegacyAssistantState {
  assistants?: unknown
  presets?: unknown
  defaultAssistant?: unknown
}

export type InstalledSkillRef = Pick<typeof agentGlobalSkillTable.$inferSelect, 'id' | 'name' | 'folderName' | 'source'>

/**
 * Legacy selections keyed by v2 assistant id, in AssistantMigrator's push order
 * (`assistants[]` → `presets[]` → `defaultAssistant`); the first non-empty selection per id wins.
 */
export function collectLegacySkillSelections(
  state: LegacyAssistantState | undefined,
  assistantIdRemap: ReadonlyMap<string, string>
): Map<string, string[]> {
  const selections = new Map<string, string[]>()
  const record = (source: unknown) => {
    if (!source || typeof source !== 'object') return
    const { id, enabledSkills } = source as { id?: unknown; enabledSkills?: unknown }
    if (typeof id !== 'string' || !id || !Array.isArray(enabledSkills)) return
    const values = enabledSkills.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    if (values.length === 0) return
    const assistantId = assistantIdRemap.get(id) ?? id
    if (!selections.has(assistantId)) selections.set(assistantId, values)
  }

  if (Array.isArray(state?.assistants)) state.assistants.forEach(record)
  if (Array.isArray(state?.presets)) state.presets.forEach(record)
  record(state?.defaultAssistant)
  return selections
}

function indexUnique(skills: readonly InstalledSkillRef[], key: (skill: InstalledSkillRef) => string) {
  const index = new Map<string, InstalledSkillRef | null>()
  for (const skill of skills) {
    const value = key(skill)
    // A key shared by two skills is ambiguous and must not pick either.
    index.set(value, index.has(value) ? null : skill)
  }
  return index
}

/** Resolve legacy values to installed-skill ids, deduplicated and in their original order. */
export function matchLegacySkills(
  values: readonly string[],
  skills: readonly InstalledSkillRef[]
): { skillIds: string[]; unmatched: string[] } {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const byFolder = new Map(skills.map((skill) => [skill.folderName, skill]))
  const byFolderLower = indexUnique(skills, (skill) => skill.folderName.toLowerCase())
  const byNameLower = indexUnique(skills, (skill) => skill.name.trim().toLowerCase())

  const skillIds: string[] = []
  const unmatched: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    const lower = value.toLowerCase()
    const skill = byId.get(value) ?? byFolder.get(value) ?? byFolderLower.get(lower) ?? byNameLower.get(lower)
    if (!skill || skill.source === 'builtin') {
      unmatched.push(value)
    } else if (!skillIds.includes(skill.id)) {
      skillIds.push(skill.id)
    }
  }
  return { skillIds, unmatched }
}

function isSameSelection(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((id, i) => actual[i] === id)
}

export class AssistantSkillSelectionMigrator extends BaseMigrator {
  readonly id = 'assistant_skill_selection'
  readonly name = 'Assistant skills'
  readonly description = 'Migrate the skills selected for each assistant'
  readonly order = 2.6

  private sourceCount = 0
  private skippedCount = 0
  private preparedSelections = new Map<string, string[]>()

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedSelections = new Map()
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.reset()
    try {
      const state = ctx.sources.reduxState.getCategory<LegacyAssistantState>('assistants')
      const assistantIdRemap =
        (ctx.sharedData.get('legacyAssistantIdRemap') as Map<string, string> | undefined) ?? new Map<string, string>()
      const selections = collectLegacySkillSelections(state, assistantIdRemap)
      this.sourceCount = selections.size
      if (selections.size === 0) return { success: true, itemCount: 0 }

      const skills = ctx.db
        .select({
          id: agentGlobalSkillTable.id,
          name: agentGlobalSkillTable.name,
          folderName: agentGlobalSkillTable.folderName,
          source: agentGlobalSkillTable.source
        })
        .from(agentGlobalSkillTable)
        .all()
      const warnings: string[] = []
      for (const [assistantId, values] of selections) {
        const { skillIds, unmatched } = matchLegacySkills(values, skills)
        if (unmatched.length > 0) {
          const warning = `Assistant ${assistantId}: skipped skills that are not installed: ${unmatched.join(', ')}`
          warnings.push(warning)
          logger.warn(warning)
        }
        if (skillIds.length === 0) {
          this.skippedCount++
          continue
        }
        this.preparedSelections.set(assistantId, skillIds)
      }

      return {
        success: true,
        itemCount: this.preparedSelections.size,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return { success: false, itemCount: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    try {
      if (this.preparedSelections.size === 0) return { success: true, processedCount: 0 }

      const rows = ctx.db
        .select({ id: assistantTable.id, settings: assistantTable.settings })
        .from(assistantTable)
        .where(inArray(assistantTable.id, [...this.preparedSelections.keys()]))
        .all()
      ctx.db.transaction((tx) => {
        for (const row of rows) {
          const contextSkillIds = this.preparedSelections.get(row.id)!
          tx.update(assistantTable)
            .set({ settings: { ...row.settings, contextSkillIds } })
            .where(eq(assistantTable.id, row.id))
            .run()
        }
      })

      const warnings: string[] = []
      const migratedIds = new Set(rows.map((row) => row.id))
      for (const assistantId of this.preparedSelections.keys()) {
        if (migratedIds.has(assistantId)) continue
        this.preparedSelections.delete(assistantId)
        this.skippedCount++
        const warning = `Assistant ${assistantId} was not migrated; its skill selection is dropped`
        warnings.push(warning)
        logger.warn(warning)
      }

      return { success: true, processedCount: rows.length, warnings: warnings.length > 0 ? warnings : undefined }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return { success: false, processedCount: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const expected = this.preparedSelections
      const rows =
        expected.size === 0
          ? []
          : ctx.db
              .select({ id: assistantTable.id, settings: assistantTable.settings })
              .from(assistantTable)
              .where(inArray(assistantTable.id, [...expected.keys()]))
              .all()
      const errors: ValidationError[] = []
      for (const row of rows) {
        const skillIds = expected.get(row.id)!
        if (!isSameSelection(row.settings.contextSkillIds, skillIds)) {
          errors.push({
            key: row.id,
            expected: skillIds,
            actual: row.settings.contextSkillIds,
            message: `Assistant ${row.id} is missing its migrated skill selection`
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount: rows.length - errors.length,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: { sourceCount: this.sourceCount, targetCount: 0, skippedCount: this.skippedCount }
      }
    }
  }
}
