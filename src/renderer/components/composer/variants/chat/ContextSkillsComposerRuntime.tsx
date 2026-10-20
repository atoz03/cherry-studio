import type { TFunction } from 'i18next'
import { Check, Loader2, RotateCcw, Save, Settings2, ToolCase, TriangleAlert } from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useSharedCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useComposerToolDispatch } from '@renderer/components/composer/ComposerToolRuntime'
import { getQuickPanelSearchAliases, prepareComposerQuickPanelSearch } from '@renderer/components/composer/quickPanel'
import type { ComposerToolFooterAction, ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { type QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { formatCompactNumber } from '@renderer/utils/number'
import {
  CONTEXT_SKILL_LARGE_TOKENS,
  type ContextSkillEstimate,
  contextSkillsCacheKey,
  isContextSkillEligible
} from '@shared/ai/contextSkills'
import type { InstalledSkill } from '@shared/types/skill'

/**
 * Fork: chat-composer panel for skills kept in the system prompt (see `@shared/ai/contextSkills`).
 *
 * Rows toggle the selection for this conversation only (a shared-cache override that main reads at
 * request time and that ends with the app session, like the v1 fork's attached skills). The footer
 * saves that selection as the assistant's default or drops back to it. Skill data and prompt-cost
 * estimates load only while the panel is open or a selection needs its chip count.
 */

export const CONTEXT_SKILLS_LAUNCHER_ID = 'context-skills'

const logger = loggerService.withContext('ContextSkillsComposerRuntime')

const EMPTY_IDS: readonly string[] = Object.freeze([])
const EMPTY_ESTIMATES: ReadonlyMap<string, ContextSkillEstimate> = new Map()

export function isSameContextSkillSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a)
  return b.every((id) => ids.has(id))
}

/** Toggle one skill; `null` means the result equals the assistant default, so no override is kept. */
export function toggleContextSkill(
  selected: readonly string[],
  assistantDefault: readonly string[],
  skillId: string
): string[] | null {
  const next = selected.includes(skillId) ? selected.filter((id) => id !== skillId) : [...selected, skillId]
  return isSameContextSkillSelection(next, assistantDefault) ? null : next
}

interface BuildContextSkillItemsOptions {
  skills: readonly InstalledSkill[]
  selectedIds: readonly string[]
  estimates: ReadonlyMap<string, ContextSkillEstimate>
  loading: boolean
  onToggle: (skillId: string) => void
  t: TFunction
}

export function buildContextSkillItems({
  skills,
  selectedIds,
  estimates,
  loading,
  onToggle,
  t
}: BuildContextSkillItemsOptions): QuickPanelListItem[] {
  if (skills.length === 0) {
    return [
      loading
        ? {
            id: 'context-skills:loading',
            label: t('common.loading'),
            icon: <Loader2 className="animate-spin" aria-hidden />,
            disabled: true
          }
        : {
            id: 'context-skills:empty',
            label: t('chat.input.context_skills.empty'),
            icon: <ToolCase aria-hidden />,
            disabled: true
          }
    ]
  }

  const selected = new Set(selectedIds)
  return skills.map((skill) => {
    const estimate = estimates.get(skill.id)
    const isSelected = selected.has(skill.id)
    const tooLarge = estimate?.status === 'too_large'
    const large = estimate?.status === 'ok' && estimate.tokens > CONTEXT_SKILL_LARGE_TOKENS
    const warning = tooLarge
      ? t('chat.input.context_skills.too_large')
      : large
        ? t('chat.input.context_skills.large')
        : undefined

    return {
      id: `context-skills:${skill.id}`,
      label: skill.name,
      description: warning ?? skill.description ?? undefined,
      filterText: [skill.name, skill.description, skill.folderName].filter(Boolean).join(' '),
      icon: warning ? <TriangleAlert className="text-warning" aria-hidden /> : <ToolCase aria-hidden />,
      isSelected,
      // A skill too large to inject can still be deselected, never newly selected.
      disabled: tooLarge && !isSelected,
      keepOpenOnAction: true,
      suffix: (
        <span className="flex items-center gap-1.5">
          {estimate?.status === 'ok' ? (
            <span className="text-muted-foreground text-xs">
              {t('chat.input.context_skills.tokens', { tokens: formatCompactNumber(estimate.tokens) })}
            </span>
          ) : null}
          {isSelected ? (
            <>
              <span className="sr-only">{t('common.selected')}</span>
              <Check aria-hidden />
            </>
          ) : null}
        </span>
      ),
      action: () => onToggle(skill.id)
    } satisfies QuickPanelListItem
  })
}

function useContextSkillEstimates(skills: readonly InstalledSkill[], enabled: boolean) {
  // contentHash keys the estimate to the skill's current files, so an edited skill is re-measured.
  const revision = skills.map((skill) => `${skill.id}:${skill.contentHash}`).join(',')
  const { data } = useSWR(
    enabled && skills.length > 0 ? ['skill.context_estimate', revision] : null,
    () => ipcApi.request('skill.context_estimate', { skillIds: skills.map((skill) => skill.id) }),
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true }
  )
  return useMemo(() => (data ? new Map(data.map((estimate) => [estimate.id, estimate])) : EMPTY_ESTIMATES), [data])
}

interface Props {
  topicId: string
  assistant?: Assistant
}

export const ContextSkillsComposerRuntime: FC<Props> = ({ topicId, assistant }) => {
  const { t } = useTranslation()
  const { toolsRegistry } = useComposerToolDispatch()
  const { isVisible, symbol, updateList } = useQuickPanel()
  const { updateAssistant } = useAssistantMutationsById(assistant?.id ?? '')
  const [override, setOverride] = useSharedCache(contextSkillsCacheKey(topicId))
  const assistantDefault = assistant?.settings.contextSkillIds ?? EMPTY_IDS
  const selectedIds = override ?? assistantDefault
  const panelOpen = isVisible && symbol === CONTEXT_SKILLS_LAUNCHER_ID

  const { skills, loading } = useInstalledSkills(undefined, { enabled: panelOpen || selectedIds.length > 0 })
  const eligibleSkills = useMemo(() => skills.filter(isContextSkillEligible), [skills])
  const estimates = useContextSkillEstimates(eligibleSkills, panelOpen)
  const activeCount = useMemo(() => {
    if (loading && skills.length === 0) return selectedIds.length
    const eligibleIds = new Set(eligibleSkills.map((skill) => skill.id))
    return selectedIds.filter((id) => eligibleIds.has(id)).length
  }, [eligibleSkills, loading, selectedIds, skills.length])

  const handleToggle = useCallback(
    (skillId: string) => {
      setOverride((previous) => toggleContextSkill(previous ?? assistantDefault, assistantDefault, skillId))
    },
    [assistantDefault, setOverride]
  )

  const handleSaveAsDefault = useCallback(async () => {
    if (!assistant || !override) return
    try {
      await updateAssistant({ settings: { contextSkillIds: override } })
      setOverride(null)
    } catch (error) {
      logger.error('Failed to save context skills as the assistant default', error as Error)
      toast.error(formatErrorMessageWithPrefix(error, t('common.save_failed')))
    }
  }, [assistant, override, setOverride, t, updateAssistant])

  const items = useMemo(
    () =>
      buildContextSkillItems({
        skills: eligibleSkills,
        selectedIds,
        estimates,
        loading,
        onToggle: handleToggle,
        t
      }),
    [eligibleSkills, estimates, handleToggle, loading, selectedIds, t]
  )

  const footerActions = useMemo<ComposerToolFooterAction[]>(() => {
    const saveLabel = t('chat.input.context_skills.save_default')
    const resetLabel = t('chat.input.context_skills.use_default')
    const manageLabel = t('plugins.manage_skills')
    return [
      {
        id: 'context-skills:save-default',
        panelSymbol: CONTEXT_SKILLS_LAUNCHER_ID,
        order: 10,
        label: saveLabel,
        ariaLabel: saveLabel,
        tooltip: saveLabel,
        icon: <Save />,
        disabled: !assistant || override === null,
        keepOpenOnAction: true,
        action: () => void handleSaveAsDefault()
      },
      {
        id: 'context-skills:use-default',
        panelSymbol: CONTEXT_SKILLS_LAUNCHER_ID,
        order: 20,
        label: resetLabel,
        ariaLabel: resetLabel,
        tooltip: resetLabel,
        icon: <RotateCcw />,
        disabled: override === null,
        keepOpenOnAction: true,
        action: () => setOverride(null)
      },
      {
        id: 'context-skills:manage',
        panelSymbol: CONTEXT_SKILLS_LAUNCHER_ID,
        order: 30,
        label: manageLabel,
        ariaLabel: manageLabel,
        tooltip: manageLabel,
        icon: <Settings2 />,
        action: () => openSettingsTab('/settings/skills')
      }
    ]
  }, [assistant, handleSaveAsDefault, override, setOverride, t])

  const launcher = useMemo<ComposerToolLauncher>(() => {
    const label = t('chat.input.context_skills.title')
    return {
      id: CONTEXT_SKILLS_LAUNCHER_ID,
      kind: 'panel',
      sources: ['popover', 'root-panel'],
      order: 45,
      label,
      description:
        override === null
          ? t('chat.input.context_skills.description')
          : t('chat.input.context_skills.conversation_only'),
      searchAliases: getQuickPanelSearchAliases(t, 'chat.input.context_skills.title', ['skills']),
      icon: <ToolCase />,
      suffix: activeCount > 0 ? String(activeCount) : undefined,
      active: activeCount > 0,
      action: ({ inputAdapter, parentPanel, queryAnchor, quickPanel, triggerInfo }) => {
        quickPanel.open({
          title: label,
          list: items,
          symbol: CONTEXT_SKILLS_LAUNCHER_ID,
          parentPanel,
          ...prepareComposerQuickPanelSearch({ inputAdapter, queryAnchor, triggerInfo })
        })
      }
    }
  }, [activeCount, items, override, t])

  useEffect(
    () => toolsRegistry.registerLaunchers(CONTEXT_SKILLS_LAUNCHER_ID, [launcher], footerActions),
    [footerActions, launcher, toolsRegistry]
  )

  useEffect(() => {
    if (panelOpen) updateList(items)
  }, [items, panelOpen, updateList])

  return null
}
