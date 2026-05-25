import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { ExpandableTruncatedText } from './ExpandableTruncatedText'
import { ToolHeader } from './GenericTools'
import type { ExitPlanModeToolInput, ExitPlanModeToolOutput } from './types'
import { AgentToolsType } from './types'

export function ExitPlanModeTool({
  input,
  output
}: {
  input?: ExitPlanModeToolInput
  output?: ExitPlanModeToolOutput
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const plan = input?.plan ?? ''
  const combinedContent = plan + '\n\n' + (output ?? '')
  const planCount = plan.split('\n\n').length

  return {
    key: AgentToolsType.ExitPlanMode,
    label: (
      <ToolHeader
        toolName={AgentToolsType.ExitPlanMode}
        stats={t('message.tools.units.plan', { count: planCount })}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div>
        <ExpandableTruncatedText output={combinedContent} render={(value) => <ReactMarkdown>{value}</ReactMarkdown>} />
      </div>
    )
  }
}
