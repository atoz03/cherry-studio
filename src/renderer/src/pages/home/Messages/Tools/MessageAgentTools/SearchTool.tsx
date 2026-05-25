import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { countLines } from '../shared/truncateOutput'
import { ExpandableTruncatedText } from './ExpandableTruncatedText'
import { StringInputTool, StringOutputTool, ToolHeader } from './GenericTools'
import {
  AgentToolsType,
  type SearchToolInput as SearchToolInputType,
  type SearchToolOutput as SearchToolOutputType
} from './types'

export function SearchTool({
  input,
  output
}: {
  input?: SearchToolInputType
  output?: SearchToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  // 如果有输出，计算结果数量
  const resultCount = countLines(output)

  return {
    key: AgentToolsType.Search,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Search}
        params={input ? `"${input}"` : undefined}
        stats={output ? t('message.tools.units.result', { count: resultCount }) : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        {input && <StringInputTool input={input} label={t('message.tools.sections.searchQuery')} />}
        <ExpandableTruncatedText
          output={output}
          render={(value) => (
            <StringOutputTool
              output={value}
              label={t('message.tools.sections.searchResults')}
              textColor="text-yellow-600 dark:text-yellow-400"
            />
          )}
        />
      </div>
    )
  }
}
