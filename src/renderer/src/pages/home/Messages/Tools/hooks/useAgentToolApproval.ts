import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { type PermissionUpdate, selectPendingPermission, toolPermissionsActions } from '@renderer/store/toolPermissions'
import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolApprovalActions, ToolApprovalState } from './useToolApproval'

const logger = loggerService.withContext('useAgentToolApproval')

export interface UseAgentToolApprovalOptions {
  /** Direct toolCallId (alternative to extracting from block) */
  toolCallId?: string
}

/**
 * Hook for tool approval logic
 * Can be used with:
 * - A ToolMessageBlock (extracts toolCallId from metadata)
 * - A direct toolCallId via options
 */
export function useAgentToolApproval(
  block?: ToolMessageBlock | null,
  options: UseAgentToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const toolResponse = block?.metadata?.rawMcpToolResponse as NormalToolResponse | undefined
  const toolCallId = options.toolCallId ?? toolResponse?.toolCallId ?? ''

  const request = useAppSelector((state) => selectPendingPermission(state.toolPermissions, toolCallId))

  const isSubmittingAllow = request?.status === 'submitting-allow'
  const isSubmittingDeny = request?.status === 'submitting-deny'
  const isSubmitting = isSubmittingAllow || isSubmittingDeny
  const isInvoking = request?.status === 'invoking'
  const isPending = request?.status === 'pending'

  const handleDecision = useCallback(
    async (
      behavior: 'allow' | 'deny',
      extra?: {
        updatedInput?: Record<string, unknown>
        updatedPermissions?: PermissionUpdate[]
        message?: string
      }
    ) => {
      if (!request) return

      logger.debug('Submitting tool permission decision', {
        requestId: request.requestId,
        toolName: request.toolName,
        behavior
      })

      dispatch(toolPermissionsActions.submissionSent({ requestId: request.requestId, behavior }))

      dispatch(
        toolPermissionsActions.requestResolved({
          requestId: request.requestId,
          behavior,
          reason: 'response',
          updatedInput: behavior === 'allow' ? (extra?.updatedInput ?? request.input) : undefined,
          message: behavior === 'deny' ? (extra?.message ?? t('agent.toolPermission.defaultDenyMessage')) : undefined,
          toolCallId
        })
      )
    },
    [dispatch, request, t, toolCallId]
  )

  const confirm = useCallback(() => {
    void handleDecision('allow')
  }, [handleDecision])

  const cancel = useCallback(() => {
    void handleDecision('deny')
  }, [handleDecision])

  // Auto-approve with suggestions if available
  const autoApprove = useCallback(() => {
    if (request?.suggestions?.length) {
      void handleDecision('allow', { updatedPermissions: request.suggestions })
    }
  }, [handleDecision, request?.suggestions])

  // Determine isWaiting - only when pending
  const isWaiting = !!request && isPending
  // isExecuting - when invoking or submitting allow
  const isExecuting = isInvoking || isSubmittingAllow

  return {
    // State
    isWaiting,
    isExecuting,
    isSubmitting,
    // Input from permission request
    input: request?.input,

    // Actions
    confirm,
    cancel,
    autoApprove: request?.suggestions?.length ? autoApprove : undefined
  }
}
