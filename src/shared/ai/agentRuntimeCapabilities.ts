import { claudeUserFacingTools } from '@shared/ai/claudecode/toolRegistry'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import { PI_PROVIDER_ID } from '@shared/data/presets/pi'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGatewayRoutableModel } from '@shared/utils/model'

import type { SlashCommand } from './slashCommands'

export interface AgentRuntimeCapabilities {
  /** i18n key for runtime selector option. */
  labelKey: string
  labelFallback: string
  /** Empty when the runtime never asks for approval. */
  permissionModes: readonly AgentPermissionMode[]
  /** Cherry's instructions and reply language reach the model. */
  instructions: boolean
  /** plan/small model fields. */
  modelTiers: boolean
  /** Heartbeat orchestration. */
  heartbeat: boolean
  knowledgeBases: boolean
  mcp: boolean
  skills: boolean
  /** Runtime's built-in tools are surfaced in the agent-tools access list (`useAgentTools`) through
   *  the Claude tool-registry pipeline. claude-only today — pi's built-ins come from `builtinTools`
   *  and are not access-controlled ClaudeToolDescriptors, so pi sets this false. */
  claudeRegistryTools: boolean
  slashCommands: readonly SlashCommand[]
  createDefaults: { permissionMode: AgentPermissionMode }
  /** Extra restriction on top of the base agent-friendly filter; null = none. `provider` is
   *  undefined for orphan models — each runtime decides fail-open vs fail-closed there. */
  isModelCompatible: ((provider: Provider | undefined, model: Model) => boolean) | null
  /** providerMetadata.cherry.transport tag stamped by the runtime's stream adapter. */
  transport: string
  /** Edit-dialog catalog rows. */
  builtinTools: () => readonly {
    id: string
    labelKey: string
    descriptionKey: string
    labelFallback?: string
    descriptionFallback?: string
    category: string
  }[]
}

const ALL_PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions'
] as const satisfies readonly AgentPermissionMode[]

// Fallback shown only until the runtime reports the session's real catalog via
// `query.supportedCommands()`. Keep it to current Claude Code built-ins (see
// https://code.claude.com/docs/en/commands).
const CLAUDE_CODE_BUILTIN_COMMANDS = [
  { command: '/clear', description: 'Start a new conversation with empty context' },
  { command: '/compact', description: 'Free up context by summarizing the conversation so far' },
  { command: '/context', description: 'Visualize current context usage as a colored grid' },
  { command: '/usage', description: 'Show session cost, plan usage limits, and activity stats' }
] as const satisfies readonly SlashCommand[]

const PI_BUILTIN_COMMANDS = [
  { command: '/compact', description: 'Compact conversation with optional focus instructions' }
] as const satisfies readonly SlashCommand[]

export const AGENT_RUNTIME_CAPABILITIES = {
  'claude-code': {
    labelKey: 'library.config.agent.field.runtime.option.claude_code',
    labelFallback: 'Claude Agent',
    permissionModes: ALL_PERMISSION_MODES,
    instructions: true,
    modelTiers: true,
    heartbeat: true,
    knowledgeBases: true,
    mcp: true,
    skills: true,
    claudeRegistryTools: true,
    slashCommands: CLAUDE_CODE_BUILTIN_COMMANDS,
    createDefaults: { permissionMode: 'auto' },
    // Claude Code reaches non-native providers through the local API Gateway, so its picker must use
    // the same routability rule as the gateway model catalog.
    isModelCompatible: (provider, model) => provider?.id !== PI_PROVIDER_ID && isGatewayRoutableModel(model),
    transport: 'claude-agent',
    builtinTools: () =>
      claudeUserFacingTools().map((tool) => ({
        id: tool.name,
        labelKey: `agent.tools.builtin.${tool.key}.label`,
        descriptionKey: `agent.tools.builtin.${tool.key}.description`,
        labelFallback: tool.label,
        descriptionFallback: tool.description,
        category: tool.category
      }))
  },
  pi: {
    labelKey: 'library.config.agent.field.runtime.option.pi',
    labelFallback: 'Pi',
    // The user's own pi CLI runs with its own tools, extensions and settings; Cherry only displays it.
    permissionModes: [],
    instructions: false,
    modelTiers: false,
    heartbeat: true,
    knowledgeBases: false,
    mcp: false,
    skills: false,
    claudeRegistryTools: false,
    slashCommands: PI_BUILTIN_COMMANDS,
    createDefaults: { permissionMode: 'default' },
    // Pi models are the ones the user configured in pi, listed under the Pi provider.
    isModelCompatible: (provider) => provider?.id === PI_PROVIDER_ID,
    transport: 'pi-agent',
    builtinTools: () =>
      PI_BUILTIN_TOOLS.map((tool) => ({
        id: tool.name,
        labelKey: `agent.tools.builtin.${tool.name}.label`,
        descriptionKey: `agent.tools.builtin.${tool.name}.description`,
        category: tool.category
      }))
  }
} as const satisfies Record<AgentType, AgentRuntimeCapabilities>
