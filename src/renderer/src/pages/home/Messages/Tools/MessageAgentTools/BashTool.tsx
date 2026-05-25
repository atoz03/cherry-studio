import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { ExpandableTruncatedText } from './ExpandableTruncatedText'
import { SkeletonValue, ToolHeader } from './GenericTools'
import { TerminalOutput } from './TerminalOutput'
import {
  AgentToolsType,
  type BashToolInput as BashToolInputType,
  type BashToolOutput as BashToolOutputType
} from './types'

export function BashTool({
  input,
  output
}: {
  input?: BashToolInputType
  output?: BashToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const command = input?.command

  return {
    key: AgentToolsType.Bash,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Bash}
        params={<SkeletonValue value={input?.description} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {/* Command 输入区域 */}
        {command && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.command')}</div>
            <TerminalOutput content={command} commandMode maxHeight="10rem" />
          </div>
        )}

        {/* Output 输出区域 */}
        {output ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
            <ExpandableTruncatedText
              output={output}
              render={(value) => <TerminalOutput content={value} maxHeight="15rem" />}
            />
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}
      </div>
    )
  }
}
