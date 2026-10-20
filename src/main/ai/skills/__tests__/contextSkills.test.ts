import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { CONTEXT_SKILL_MAX_BYTES, contextSkillsCacheKey } from '@shared/ai/contextSkills'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import {
  estimateContextSkills,
  loadContextSkills,
  resolveContextSkillIds,
  stripSkillFrontmatter
} from '../contextSkills'

const REVIEW_ID = '11111111-1111-4111-8111-111111111111'
const WRITER_ID = '22222222-2222-4222-8222-222222222222'
const BUILTIN_ID = '33333333-3333-4333-8333-333333333333'
const DISABLED_ID = '44444444-4444-4444-8444-444444444444'
const HUGE_ID = '55555555-5555-4555-8555-555555555555'
const MISSING_FILE_ID = '66666666-6666-4666-8666-666666666666'

describe('context skills', () => {
  const dbh = setupTestDatabase()
  let baseDir: string
  let skillsRoot: string
  let restoreGetPath = () => {}

  async function writeSkill(folderName: string, content: string, fileName = 'SKILL.md') {
    await fs.promises.mkdir(path.join(skillsRoot, folderName), { recursive: true })
    await fs.promises.writeFile(path.join(skillsRoot, folderName, fileName), content)
  }

  beforeEach(async () => {
    MockMainCacheServiceUtils.resetMocks()
    baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'context-skills-'))
    skillsRoot = path.join(baseDir, 'skills')
    const getPathSpy = vi
      .spyOn(application, 'getPath')
      .mockImplementation((key: string) => (key === 'feature.agents.skills' ? skillsRoot : path.join(skillsRoot, key)))
    restoreGetPath = () => getPathSpy.mockRestore()

    await dbh.db.insert(agentGlobalSkillTable).values([
      {
        id: REVIEW_ID,
        name: 'Code review',
        description: 'Review diffs',
        folderName: 'review',
        source: 'local',
        contentHash: 'a',
        isEnabled: true
      },
      { id: WRITER_ID, name: 'Writer', folderName: 'writer', source: 'marketplace', contentHash: 'b', isEnabled: true },
      {
        id: BUILTIN_ID,
        name: 'Browser',
        folderName: 'cherry-browser',
        source: 'builtin',
        contentHash: 'c',
        isEnabled: true
      },
      { id: DISABLED_ID, name: 'Off', folderName: 'off', source: 'local', contentHash: 'd', isEnabled: false },
      { id: HUGE_ID, name: 'Huge', folderName: 'huge', source: 'local', contentHash: 'e', isEnabled: true },
      { id: MISSING_FILE_ID, name: 'Gone', folderName: 'gone', source: 'local', contentHash: 'f', isEnabled: true }
    ])
    await writeSkill(
      'review',
      '---\nname: Code review\ndescription: Review diffs\n---\n\n# Review\nCheck every hunk.\n'
    )
    await writeSkill('writer', 'Write plainly.', 'skill.md')
    await writeSkill('cherry-browser', '---\nname: Browser\n---\nDrive the browser.')
    await writeSkill('off', 'Never injected.')
    await writeSkill('huge', 'x'.repeat(CONTEXT_SKILL_MAX_BYTES + 1))
  })

  afterEach(async () => {
    restoreGetPath()
    await fs.promises.rm(baseDir, { recursive: true, force: true })
  })

  describe('resolveContextSkillIds', () => {
    const assistant = { settings: { ...DEFAULT_ASSISTANT_SETTINGS, contextSkillIds: [REVIEW_ID] } }

    it('follows the assistant default when the conversation has no override', () => {
      expect(resolveContextSkillIds(assistant, 'topic-1')).toEqual([REVIEW_ID])
      expect(resolveContextSkillIds({ settings: DEFAULT_ASSISTANT_SETTINGS }, 'topic-1')).toEqual([])
      expect(resolveContextSkillIds(undefined, undefined)).toEqual([])
    })

    it('lets the conversation override win, including an explicit empty selection', () => {
      MockMainCacheServiceUtils.setSharedCacheValue(contextSkillsCacheKey('topic-1'), [WRITER_ID])
      MockMainCacheServiceUtils.setSharedCacheValue(contextSkillsCacheKey('topic-2'), [])

      expect(resolveContextSkillIds(assistant, 'topic-1')).toEqual([WRITER_ID])
      expect(resolveContextSkillIds(assistant, 'topic-2')).toEqual([])
      expect(resolveContextSkillIds(assistant, 'topic-3')).toEqual([REVIEW_ID])
    })
  })

  describe('loadContextSkills', () => {
    it('returns SKILL.md bodies without frontmatter, in selection order, deduplicated', async () => {
      const skills = await loadContextSkills([WRITER_ID, REVIEW_ID, WRITER_ID])

      expect(skills).toEqual([
        { id: WRITER_ID, name: 'Writer', description: null, body: 'Write plainly.' },
        { id: REVIEW_ID, name: 'Code review', description: 'Review diffs', body: '# Review\nCheck every hunk.' }
      ])
    })

    it('skips unknown, built-in, switched-off, oversized and file-less skills instead of failing', async () => {
      const skills = await loadContextSkills([
        'not-installed',
        BUILTIN_ID,
        DISABLED_ID,
        HUGE_ID,
        MISSING_FILE_ID,
        REVIEW_ID
      ])

      expect(skills.map((skill) => skill.id)).toEqual([REVIEW_ID])
    })

    it('never reads outside the managed skills directory', async () => {
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: 'escape',
        name: 'Escape',
        folderName: '../outside',
        source: 'local',
        contentHash: 'g',
        isEnabled: true
      })
      await fs.promises.mkdir(path.join(baseDir, 'outside'))
      await fs.promises.writeFile(path.join(baseDir, 'outside', 'SKILL.md'), 'secret')

      expect(await loadContextSkills(['escape'])).toEqual([])
    })
  })

  describe('estimateContextSkills', () => {
    it('reports a token estimate for usable skills and the reason for the rest', async () => {
      const estimates = await estimateContextSkills([REVIEW_ID, HUGE_ID, BUILTIN_ID])

      expect(estimates[0]).toMatchObject({ id: REVIEW_ID, status: 'ok' })
      expect(estimates[0].tokens).toBeGreaterThan(0)
      expect(estimates.slice(1)).toEqual([
        { id: HUGE_ID, status: 'too_large', tokens: 0 },
        { id: BUILTIN_ID, status: 'unavailable', tokens: 0 }
      ])
    })
  })

  describe('stripSkillFrontmatter', () => {
    it('drops a leading frontmatter block, including an empty one or one after a BOM', () => {
      expect(stripSkillFrontmatter('---\nname: a\n---\nbody')).toBe('body')
      expect(stripSkillFrontmatter('---\n---\nbody')).toBe('body')
      expect(stripSkillFrontmatter('\uFEFF---\r\nname: a\r\n---\r\nbody')).toBe('body')
    })

    it('keeps content that has no complete frontmatter block', () => {
      expect(stripSkillFrontmatter('# Title\n---\nnot frontmatter')).toBe('# Title\n---\nnot frontmatter')
      expect(stripSkillFrontmatter('---\nname: a\nno closing fence')).toBe('---\nname: a\nno closing fence')
    })
  })
})
