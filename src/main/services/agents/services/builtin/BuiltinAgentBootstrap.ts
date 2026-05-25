import { loggerService } from '@logger'
import { agentService } from '@main/services/agents/services/AgentService'
import { installBuiltinSkills } from '@main/utils/builtinSkills'

const logger = loggerService.withContext('BuiltinAgentBootstrap')
const LEGACY_PRESET_AGENT_IDS = ['cherry-assistant-default', 'cherry-claw-default'] as const

async function purgeLegacyPresetAgents(): Promise<void> {
  await Promise.all(
    LEGACY_PRESET_AGENT_IDS.map(async (id) => {
      try {
        const deleted = await agentService.deleteAgent(id)
        if (deleted) {
          logger.info('Purged legacy preset agent', { id })
        }
      } catch (error) {
        logger.error('Failed to purge legacy preset agent', error as Error)
      }
    })
  )
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
