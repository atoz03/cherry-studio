import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { loggerService } from '@logger'
import {
  CONTEXT_SKILL_MAX_BYTES,
  type ContextSkillEstimate,
  contextSkillsCacheKey,
  isContextSkillEligible
} from '@shared/ai/contextSkills'
import type { Assistant } from '@shared/data/types/assistant'

import { tokenxTokenizer } from '../tokens/textTokenizer'
import { type ContextSkill, formatContextSkill } from './contextSkillsPrompt'

/**
 * Fork: skills as persistent system context in normal chats (see `@shared/ai/contextSkills`).
 *
 * Only the SKILL.md body is injected, frontmatter stripped. Scripts, references and assets the
 * skill bundles are not: a normal chat has no tool that can read or run files from the skill
 * directory, so the prompt says so instead of pretending they exist (same as the v1 fork).
 */

const logger = loggerService.withContext('ContextSkills')

const SKILL_MD_VARIANTS = ['SKILL.md', 'skill.md']

type ContextSkillRead = { status: 'ok'; skill: ContextSkill } | { status: 'too_large' | 'unavailable' }

/** The conversation's override wins over the assistant default; no selection yields `[]`. */
export function resolveContextSkillIds(
  assistant: Pick<Assistant, 'settings'> | undefined,
  topicId: string | undefined
): string[] {
  if (topicId) {
    const override = application.get('CacheService').getShared(contextSkillsCacheKey(topicId))
    if (Array.isArray(override)) return override
  }
  return assistant?.settings.contextSkillIds ?? []
}

/**
 * Read the selected skills in selection order. Skills that were uninstalled, switched off, are
 * built-in, have no readable SKILL.md, or exceed `CONTEXT_SKILL_MAX_BYTES` are skipped with a
 * warning so a stale selection never fails the request.
 */
export async function loadContextSkills(ids: readonly string[]): Promise<ContextSkill[]> {
  const skills: ContextSkill[] = []
  for (const id of new Set(ids)) {
    const read = await readContextSkill(id)
    if (read.status === 'ok') {
      skills.push(read.skill)
    } else {
      logger.warn('Skipping context skill', { id, reason: read.status })
    }
  }
  return skills
}

/** Prompt-cost estimate per skill for the composer; never throws for a single bad skill. */
export async function estimateContextSkills(ids: readonly string[]): Promise<ContextSkillEstimate[]> {
  const estimates: ContextSkillEstimate[] = []
  for (const id of new Set(ids)) {
    const read = await readContextSkill(id)
    estimates.push(
      read.status === 'ok'
        ? { id, status: 'ok', tokens: tokenxTokenizer.count(formatContextSkill(read.skill)) }
        : { id, status: read.status, tokens: 0 }
    )
  }
  return estimates
}

/** Drop a leading YAML frontmatter block; content without a closing fence is kept as-is. */
export function stripSkillFrontmatter(content: string): string {
  const match = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(content)
  return (match ? content.slice(match[0].length) : content).trim()
}

async function readContextSkill(id: string): Promise<ContextSkillRead> {
  const skill = agentGlobalSkillService.getById(id)
  if (!skill || !isContextSkillEligible(skill)) return { status: 'unavailable' }

  const root = path.resolve(application.getPath('feature.agents.skills'))
  const directory = path.resolve(root, skill.folderName)
  const relative = path.relative(root, directory)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { status: 'unavailable' }

  for (const variant of SKILL_MD_VARIANTS) {
    const filePath = path.join(directory, variant)
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) continue
      if (stat.size > CONTEXT_SKILL_MAX_BYTES) return { status: 'too_large' }
      const body = stripSkillFrontmatter(await fs.promises.readFile(filePath, 'utf-8'))
      if (!body) return { status: 'unavailable' }
      return { status: 'ok', skill: { id, name: skill.name, description: skill.description, body } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      logger.warn('Failed to read context skill', { id, filePath, error })
      return { status: 'unavailable' }
    }
  }
  return { status: 'unavailable' }
}
