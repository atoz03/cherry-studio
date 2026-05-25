import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { app } from 'electron'

import { getDataPath, toAsarUnpackedPath } from '.'

const logger = loggerService.withContext('builtinSkills')

const VERSION_FILE = '.version'

/**
 * Copy built-in skills from app resources to the global skills storage
 * directory. Skills are now file-backed and no longer registered in the
 * removed agents SQLite/Drizzle subsystem.
 *
 * Storage:  {userData}/Data/Skills/{folderName}/
 *
 * Each installed skill gets a `.version` file recording the app version that
 * installed it. On subsequent launches the bundled version is compared with
 * the installed version — the skill files are overwritten only when the app
 * ships a newer version.
 */
export async function installBuiltinSkills(): Promise<void> {
  const resourceSkillsPath = toAsarUnpackedPath(path.join(app.getAppPath(), 'resources', 'skills'))
  const globalSkillsPath = getDataPath('Skills')
  const appVersion = app.getVersion()

  try {
    await fs.access(resourceSkillsPath)
  } catch {
    return
  }

  const entries = await fs.readdir(resourceSkillsPath, { withFileTypes: true })
  const dirs = entries.filter((e) => {
    if (!e.isDirectory()) return false
    const destPath = path.join(globalSkillsPath, e.name)
    return destPath.startsWith(globalSkillsPath + path.sep)
  })

  let installed = 0
  // Process sequentially to avoid interleaved delete+insert on the skills
  // table when multiple builtins require a metadata refresh.
  for (const entry of dirs) {
    const destPath = path.join(globalSkillsPath, entry.name)
    const filesUpdated = !(await isUpToDate(destPath, appVersion))

    if (filesUpdated) {
      await fs.mkdir(destPath, { recursive: true })
      await fs.cp(path.join(resourceSkillsPath, entry.name), destPath, { recursive: true })
      await fs.writeFile(path.join(destPath, VERSION_FILE), appVersion, 'utf-8')
      installed++
    }
  }

  if (installed > 0) {
    logger.info('Built-in skills installed', { installed, version: appVersion })
  }
}

async function isUpToDate(destPath: string, appVersion: string): Promise<boolean> {
  try {
    const installedVersion = (await fs.readFile(path.join(destPath, VERSION_FILE), 'utf-8')).trim()
    return installedVersion === appVersion
  } catch {
    return false
  }
}
