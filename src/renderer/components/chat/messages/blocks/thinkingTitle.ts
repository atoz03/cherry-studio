import type { TFunction } from 'i18next'

import type { ReasoningEffortOption } from '@shared/types/aiSdk'

/** Efforts that name a concrete thinking level; `default` / `auto` / `none` keep the generic title. */
const EFFORT_LABEL_KEYS = {
  minimal: 'message.thinking.effort.minimal',
  low: 'message.thinking.effort.low',
  medium: 'message.thinking.effort.medium',
  high: 'message.thinking.effort.high',
  xhigh: 'message.thinking.effort.xhigh',
  max: 'message.thinking.effort.max',
  ultra: 'message.thinking.effort.ultra'
} as const satisfies Partial<Record<ReasoningEffortOption, string>>

export interface ThinkingTitleInput {
  isThinking: boolean
  /** Measured reasoning duration (`providerMetadata.cherry.thinkingMs`). */
  thinkingMs?: number
  /** The effort frozen on the assistant turn (`turnOptions.reasoningEffort`). */
  reasoningEffort?: ReasoningEffortOption
}

/** One decimal place; anything shorter than 0.1s still reads as 0.1s. */
export function formatThinkingSeconds(thinkingMs: number): string {
  return (Math.max(thinkingMs, 100) / 1000).toFixed(1)
}

/**
 * Title of a reasoning block: "Thinking with high effort" while streaming,
 * "Thought with high effort (3.5s)" once done. Without a named effort it falls back
 * to the generic labels, and without a measured duration to the static done label.
 */
export function getThinkingTitle(t: TFunction, { isThinking, thinkingMs, reasoningEffort }: ThinkingTitleInput) {
  const effortKey = reasoningEffort ? EFFORT_LABEL_KEYS[reasoningEffort as keyof typeof EFFORT_LABEL_KEYS] : undefined
  const effort = effortKey ? t(effortKey) : undefined

  if (isThinking) {
    return effort ? t('message.thinking.in_progress_with_effort', { effort }) : t('message.tools.placeholder.thinking')
  }
  if (typeof thinkingMs !== 'number' || !Number.isFinite(thinkingMs)) return t('common.reasoning_content')

  const seconds = formatThinkingSeconds(thinkingMs)
  return effort ? t('message.thinking.done_with_effort', { effort, seconds }) : t('message.thinking.done', { seconds })
}
