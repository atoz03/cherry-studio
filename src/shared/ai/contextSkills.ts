import * as z from 'zod'

import type { InstalledSkill } from '@shared/data/api/schemas/skills'

/**
 * Fork: skills as persistent system context in normal chats.
 *
 * An assistant keeps a default selection in `settings.contextSkillIds`. The chat composer can
 * override it for one conversation through the shared cache key `contextSkillsCacheKey(topicId)`
 * (`null` = follow the assistant). Main reads the effective selection at request time and appends
 * each skill's SKILL.md body to the system prompt (`src/main/ai/skills/contextSkills.ts`).
 */

/** A SKILL.md larger than this is never injected — it would crowd out the conversation itself. */
export const CONTEXT_SKILL_MAX_BYTES = 128 * 1024

/** The composer flags skills whose estimated prompt cost exceeds this many tokens. */
export const CONTEXT_SKILL_LARGE_TOKENS = 8_000

export function contextSkillsCacheKey(topicId: string) {
  return `chat.context_skills.${topicId}` as const
}

/**
 * Built-in skills drive agent-only tools (browser, computer use, skill authoring), so they are
 * never offered to normal chats; a skill switched off in the library is unavailable everywhere.
 */
export function isContextSkillEligible(skill: Pick<InstalledSkill, 'source' | 'isGlobalEnabled'>): boolean {
  return skill.source !== 'builtin' && skill.isGlobalEnabled
}

export const ContextSkillEstimateSchema = z.object({
  id: z.string(),
  /** `tokenx` estimate of what the skill adds to the system prompt; 0 unless `status` is `ok`. */
  tokens: z.number().int().nonnegative(),
  status: z.enum(['ok', 'too_large', 'unavailable'])
})
export type ContextSkillEstimate = z.infer<typeof ContextSkillEstimateSchema>
