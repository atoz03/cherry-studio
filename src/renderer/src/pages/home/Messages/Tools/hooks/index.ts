// Tool approval hooks - unified abstraction for MCP and Agent tool approval
export { useAgentToolApproval, type UseAgentToolApprovalOptions } from './useAgentToolApproval'
export {
  isBlockWaitingApproval,
  type ToolApprovalActions,
  type ToolApprovalState,
  useMcpToolApproval,
  useToolApproval,
  type UseToolApprovalOptions
} from './useToolApproval'
