import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { CONTEXT_SKILL_LARGE_TOKENS, type ContextSkillEstimate } from '@shared/ai/contextSkills'
import type { InstalledSkill } from '@shared/types/skill'

import { buildContextSkillItems, toggleContextSkill } from '../ContextSkillsComposerRuntime'

const t = ((key: string) => key) as unknown as TFunction

function skill(id: string): InstalledSkill {
  return {
    id,
    name: `Skill ${id}`,
    description: `About ${id}`,
    folderName: id,
    source: 'local',
    sourceUrl: null,
    namespace: null,
    author: null,
    version: null,
    sourceTags: [],
    contentHash: id,
    isGlobalEnabled: true,
    isEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('toggleContextSkill', () => {
  it('adds or removes one skill for the conversation', () => {
    expect(toggleContextSkill(['a'], ['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleContextSkill(['a', 'b'], [], 'a')).toEqual(['b'])
  })

  it('drops the override once the selection matches the assistant default again', () => {
    expect(toggleContextSkill(['a', 'b'], ['b', 'a', 'c'], 'c')).toBeNull()
    expect(toggleContextSkill(['a'], [], 'a')).toBeNull()
  })
})

describe('buildContextSkillItems', () => {
  const estimates = new Map<string, ContextSkillEstimate>([
    ['small', { id: 'small', status: 'ok', tokens: 120 }],
    ['large', { id: 'large', status: 'ok', tokens: CONTEXT_SKILL_LARGE_TOKENS + 1 }],
    ['huge', { id: 'huge', status: 'too_large', tokens: 0 }]
  ])

  it('marks selected skills, warns about costly ones, and blocks selecting one that cannot be injected', () => {
    const items = buildContextSkillItems({
      skills: [skill('small'), skill('large'), skill('huge')],
      selectedIds: ['small'],
      estimates,
      loading: false,
      onToggle: vi.fn(),
      t
    })

    expect(items.map(({ isSelected, disabled, description }) => ({ isSelected, disabled, description }))).toEqual([
      { isSelected: true, disabled: false, description: 'About small' },
      { isSelected: false, disabled: false, description: 'chat.input.context_skills.large' },
      { isSelected: false, disabled: true, description: 'chat.input.context_skills.too_large' }
    ])
  })

  it('still lets a too-large skill that is already selected be removed', () => {
    const onToggle = vi.fn()
    const [item] = buildContextSkillItems({
      skills: [skill('huge')],
      selectedIds: ['huge'],
      estimates,
      loading: false,
      onToggle,
      t
    })

    expect(item.disabled).toBe(false)
    item.action?.({} as never)
    expect(onToggle).toHaveBeenCalledWith('huge')
  })

  it('shows a single disabled placeholder while loading or when nothing is installed', () => {
    const options = { selectedIds: [], estimates, onToggle: vi.fn(), t, skills: [] }
    expect(buildContextSkillItems({ ...options, loading: true })).toMatchObject([
      { id: 'context-skills:loading', disabled: true }
    ])
    expect(buildContextSkillItems({ ...options, loading: false })).toMatchObject([
      { id: 'context-skills:empty', label: 'chat.input.context_skills.empty', disabled: true }
    ])
  })
})
