/**
 * The atoz03 fork's v1 stamped the request's reasoning effort on each thinking block
 * (`metadata.reasoning_effort`: minimal/low/medium/high/xhigh) so replays showed the effort a
 * turn ran with. v2 freezes the same fact on the assistant row as `turnOptions.reasoningEffort`.
 * Upstream v1 never wrote the key, so this is a no-op for upstream profiles.
 */

import type { AssistantTurnOptions } from '@shared/data/types/message'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

const LEGACY_THINKING_EFFORT_KEY = 'reasoning_effort'

export function legacyThinkingTurnOptions(
  blocks: ReadonlyArray<{ type: string; metadata?: Record<string, unknown> }>
): AssistantTurnOptions | undefined {
  for (const block of blocks) {
    if (block.type !== 'thinking') continue
    const effort = ReasoningEffortOptionSchema.safeParse(block.metadata?.[LEGACY_THINKING_EFFORT_KEY])
    if (effort.success && effort.data !== 'default') return { reasoningEffort: effort.data }
  }
  return undefined
}
