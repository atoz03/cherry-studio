/**
 * Fork: system-prompt section for skills kept in a normal chat's context (loaded by
 * `./contextSkills.ts`). One `<skills>` block wraps a `<skill>` element per
 * selected skill, in selection order, so the model can tell the skills apart from the assistant
 * prompt and from each other.
 */

export interface ContextSkill {
  id: string
  name: string
  description: string | null
  /** SKILL.md without its frontmatter. */
  body: string
}

/** One delimited `<skills>` section, or `undefined` when nothing is selected. */
export function formatContextSkillsPrompt(skills: readonly ContextSkill[]): string | undefined {
  if (skills.length === 0) return undefined
  return [
    '<skills>',
    'The user attached the following skills to this conversation. Follow the instructions of every skill that applies to the request. Files a skill refers to (scripts, references, assets) are not available here; work from the instructions below.',
    ...skills.map(formatContextSkill),
    '</skills>'
  ].join('\n\n')
}

export function formatContextSkill(skill: ContextSkill): string {
  const description = skill.description ? ` description="${escapeAttribute(skill.description)}"` : ''
  return `<skill name="${escapeAttribute(skill.name)}"${description}>\n${skill.body}\n</skill>`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim()
}
