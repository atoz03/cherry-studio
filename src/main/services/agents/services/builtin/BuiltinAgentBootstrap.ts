import { loggerService } from '@logger'
import { agentService } from '@main/services/agents/services/AgentService'
import { installBuiltinSkills } from '@main/utils/builtinSkills'

const logger = loggerService.withContext('BuiltinAgentBootstrap')

async function purgeLegacyPresetAgents(): Promise<void> {
  try {
    const deletedIds = await agentService.purgeLegacyPresetAgents()
    for (const id of deletedIds) {
      logger.info('Purged legacy preset agent', { id })
    }
  } catch (error) {
    logger.error('Failed to purge legacy preset agents', error as Error)
  }
}

/**
 * Initialize built-in skills.
 * Built-in agent presets have been removed, so startup no longer provisions
 * legacy preset agent instances.
 */
export async function bootstrapBuiltinAgents(): Promise<void> {
  await purgeLegacyPresetAgents()
  try {
    await installBuiltinSkills()
  } catch (error) {
    logger.error('Failed to install built-in skills', error as Error)
  }
}
