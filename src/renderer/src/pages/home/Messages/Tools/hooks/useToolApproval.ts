import type { ToolMessageBlock } from '@renderer/types/newMessage'

import { useMcpToolApproval } from './useMcpToolApproval'

/**
 * Unified tool approval state
 */
export interface ToolApprovalState {
  /** Whether the tool is waiting for user confirmation */
  isWaiting: boolean
  /** Whether the tool is currently executing after approval */
  isExecuting: boolean
  /** Whether a submission is in progress */
  isSubmitting: boolean
  /** Tool input from permission request */
  input?: Record<string, unknown>
}

/**
 * Unified tool approval actions
 */
export interface ToolApprovalActions {
  /** Confirm/approve the tool execution */
  confirm: () => void | Promise<void>
  /** Cancel/deny the tool execution */
  cancel: () => void | Promise<void>
  /** Auto-approve this tool for future calls (if available) */
  autoApprove?: () => void | Promise<void>
}

export interface UseToolApprovalOptions {
  /** Reserved for future approval types */
  forceType?: 'mcp'
}

/**
 * Hook for tool approval. Agents approval was removed together with the
 * agents runtime, so tool approvals now use the MCP path only.
 */
export function useToolApproval(
  block: ToolMessageBlock,
  options: UseToolApprovalOptions = {}
): ToolApprovalState & ToolApprovalActions {
  void options
  const mcpApproval = useMcpToolApproval(block)

  return mcpApproval
}

/**
 * Determine if a block needs approval (either MCP or Agent)
 */
export function isBlockWaitingApproval(block: ToolMessageBlock): boolean {
  return block.metadata?.rawMcpToolResponse?.status === 'pending'
}

export { useMcpToolApproval } from './useMcpToolApproval'
