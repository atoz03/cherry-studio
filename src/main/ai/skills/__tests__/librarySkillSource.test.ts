import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildLibrarySkillSources, LIBRARY_SKILL_SOURCE_ID } from '../librarySkillSource'

describe('buildLibrarySkillSources', () => {
  const home = path.resolve('/home/user')

  it('adds the configured folder as one more discovery root', () => {
    const libraryPath = path.resolve('/data/skills')
    expect(buildLibrarySkillSources(home, ` ${libraryPath} `, 'Skill library')).toEqual([
      { id: LIBRARY_SKILL_SOURCE_ID, name: 'Skill library', directoryPath: libraryPath }
    ])
  })

  it('expands a leading tilde to the home directory, as the v1 default `~/skills` was written', () => {
    expect(buildLibrarySkillSources(home, '~/skills', 'Skill library')[0]?.directoryPath).toBe(
      path.join(home, 'skills')
    )
  })

  it('yields no source for an unset, blank or relative path', () => {
    expect(buildLibrarySkillSources(home, null, 'Skill library')).toEqual([])
    expect(buildLibrarySkillSources(home, '   ', 'Skill library')).toEqual([])
    expect(buildLibrarySkillSources(home, 'skills', 'Skill library')).toEqual([])
  })
})
