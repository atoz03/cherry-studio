import { loggerService } from '@logger'
import { installBuiltinSkills } from '@main/utils/builtinSkills'

const logger = loggerService.withContext('BuiltinAgentBootstrap')

/**
 * Initialize built-in skills.
 * Built-in agent presets have been removed, so startup no longer provisions
 * legacy preset agent instances.
 */
export async function bootstrapBuiltinAgents(): Promise<void> {
  try {
    await installBuiltinSkills()
  } catch (error) {
    logger.error('Failed to install built-in skills', error as Error)
  }
}
