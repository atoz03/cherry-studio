import type { CollapseProps } from 'antd'

import { ExpandableTruncatedText } from './ExpandableTruncatedText'
import { ToolHeader } from './GenericTools'
import { AgentToolsType, type WebFetchToolInput, type WebFetchToolOutput } from './types'

export function WebFetchTool({
  input,
  output
}: {
  input?: WebFetchToolInput
  output?: WebFetchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: AgentToolsType.WebFetch,
    label: (
      <ToolHeader toolName={AgentToolsType.WebFetch} params={input?.url} variant="collapse-label" showStatus={false} />
    ),
    children: (
      <div>
        <ExpandableTruncatedText output={output} render={(value) => <div>{value}</div>} />
      </div>
    )
  }
}
