import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines } from '../shared/truncateOutput'
import { ExpandableTruncatedText } from './ExpandableTruncatedText'
import { ToolHeader } from './GenericTools'
import { AgentToolsType, type WebSearchToolInput, type WebSearchToolOutput } from './types'

export function WebSearchTool({
  input,
  output
}: {
  input?: WebSearchToolInput
  output?: WebSearchToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = countLines(output)

  return {
    key: AgentToolsType.WebSearch,
    label: (
      <ToolHeader
        toolName={AgentToolsType.WebSearch}
        params={input?.query}
        stats={output ? t('message.tools.units.result', { count: resultCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <ExpandableTruncatedText output={output} render={(value) => <div>{value}</div>} />
      </div>
    )
  }
}
