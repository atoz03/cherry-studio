import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { MIGRATION_REDUX_SLICES } from '@shared/data/migration/v2/types'

import { BOOT_CONFIG_REDUX_MAPPINGS } from '../migrators/mappings/BootConfigMappings'
import { COMPLEX_PREFERENCE_MAPPINGS } from '../migrators/mappings/ComplexPreferenceMappings'
import { REDUX_STORE_MAPPINGS } from '../migrators/mappings/PreferencesMappings'

const MIGRATION_DIR = path.join(process.cwd(), 'src/main/data/migration/v2')

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSourceFiles(fullPath)
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

/** Slices named literally in `reduxState.get('x', …)` / `reduxState.getCategory<…>('x')` calls. */
function sliceReadsInSource(): Set<string> {
  // The generic may span lines and nest `<…>`, so it is matched lazily up to the call's `(`.
  const call = /reduxState\s*\.\s*(?:get|getCategory)\s*(?:<[\s\S]*?>)?\s*\(\s*['"]([^'"]+)['"]/g
  const slices = new Set<string>()
  for (const file of listSourceFiles(MIGRATION_DIR)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(call)) slices.add(match[1])
  }
  return slices
}

describe('MIGRATION_REDUX_SLICES', () => {
  const exported = new Set<string>(MIGRATION_REDUX_SLICES)

  it('exports every Redux category read by the preference and boot-config mappings', () => {
    // A category missing here reaches the migrator as `undefined`, so its settings silently reset to defaults.
    const mapped = [
      ...Object.keys(REDUX_STORE_MAPPINGS),
      ...Object.keys(BOOT_CONFIG_REDUX_MAPPINGS),
      ...COMPLEX_PREFERENCE_MAPPINGS.flatMap((mapping) =>
        Object.values(mapping.sources).flatMap((source) =>
          source.source === 'redux' && source.category ? [source.category] : []
        )
      )
    ]

    expect([...new Set(mapped)].filter((category) => !exported.has(category))).toEqual([])
  })

  it('exports every Redux slice a migrator reads directly', () => {
    const read = sliceReadsInSource()
    // Control: a multi-line generic (MiniAppMigrator) must not hide its slice from the scan.
    expect(read).toContain('minapps')

    expect([...read].filter((slice) => !exported.has(slice))).toEqual([])
  })
})
