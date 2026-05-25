import type { CollapseProps } from 'antd'
import { Tag } from 'antd'
import ReactMarkdown from 'react-markdown'

import { ClickableFilePath } from './ClickableFilePath'
import { ExpandableTruncatedText } from './ExpandableTruncatedText'
import { ToolHeader } from './GenericTools'
import type { NotebookEditToolInput, NotebookEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function NotebookEditTool({
  input,
  output
}: {
  input?: NotebookEditToolInput
  output?: NotebookEditToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  return {
    key: AgentToolsType.NotebookEdit,
    label: (
      <div className="flex items-center gap-2">
        <ToolHeader toolName={AgentToolsType.NotebookEdit} variant="collapse-label" showStatus={false} />
        <Tag color="blue">{input?.notebook_path ? <ClickableFilePath path={input.notebook_path} /> : undefined}</Tag>
      </div>
    ),
    children: (
      <div>
        <ExpandableTruncatedText output={output} render={(value) => <ReactMarkdown>{value}</ReactMarkdown>} />
      </div>
    )
  }
}
