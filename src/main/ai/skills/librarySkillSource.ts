import * as path from 'node:path'

import { application } from '@application'
import { t } from '@main/i18n'

import type { SystemSkillSource } from './systemSkillSources'

/** Fork: id of the user-chosen skills library among the system skill sources. */
export const LIBRARY_SKILL_SOURCE_ID = 'library'

/**
 * Fork: the local skills library (`feature.skills.library_path`) as one more discovery root for
 * "Import from system". It is scanned only when that dialog runs discovery — never at boot and
 * never watched — and importing copies the skill into the managed library, as in the v1 fork.
 */
export function resolveLibrarySkillSources(home: string): SystemSkillSource[] {
  return buildLibrarySkillSources(
    home,
    application.get('PreferenceService').get('feature.skills.library_path'),
    t('skill.library_source.name')
  )
}

/** A blank or relative library path yields no source; a leading `~` means the home directory. */
export function buildLibrarySkillSources(
  home: string,
  libraryPath: string | null | undefined,
  name: string
): SystemSkillSource[] {
  const value = libraryPath?.trim()
  if (!value) return []
  const expanded = value === '~' || /^~[/\\]/.test(value) ? path.join(home, value.slice(1)) : value
  if (!path.isAbsolute(expanded)) return []
  return [{ id: LIBRARY_SKILL_SOURCE_ID, name, directoryPath: path.normalize(expanded) }]
}
