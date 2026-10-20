import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { loggerService } from '@logger'

const logger = loggerService.withContext('macFonts')
const execFileAsync = promisify(execFile)

/**
 * Family names from the `System Families:` section of `atsutil fonts -list`, deduplicated
 * and sorted. Unlike `font-list`, it includes CJK families such as PingFang SC and Songti SC.
 */
export function parseAtsutilFontFamilies(output: string): string[] {
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === 'System Families:')
  if (start < 0) return []

  const families = new Set<string>()
  for (const line of lines.slice(start + 1)) {
    // Section headers start at column 0; entries are indented.
    if (line && !/^\s/.test(line)) break
    const family = line.trim()
    if (family) families.add(family)
  }
  return [...families].sort((a, b) => a.localeCompare(b))
}

/** macOS system font families via `atsutil`, spawned only on request; `[]` when it is unavailable. */
export async function getMacFontFamilies(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('atsutil', ['fonts', '-list'], { maxBuffer: 10 * 1024 * 1024 })
    return parseAtsutilFontFamilies(stdout)
  } catch (error) {
    logger.warn('atsutil font listing failed, falling back to font-list', error as Error)
    return []
  }
}
