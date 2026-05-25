import { Button } from 'antd'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { truncateOutput, type TruncateResult } from '../shared/truncateOutput'
import { TruncatedIndicator } from './GenericTools'

const HEAD_CHARS = 20000
const TAIL_CHARS = 20000

interface Props {
  output?: string | null
  maxLength?: number
  className?: string
  render: (value: string) => ReactNode
}

function buildPreview(output: string): string {
  if (output.length <= HEAD_CHARS + TAIL_CHARS) return output
  const head = output.slice(0, HEAD_CHARS)
  const tail = output.slice(-TAIL_CHARS)
  return `${head}\n\n...\n\n${tail}`
}

function buildTruncateResult(
  output: string,
  expanded: boolean,
  maxLength: number
): TruncateResult & { canExpand: boolean; previewUsed: boolean } {
  if (expanded) {
    return {
      data: output,
      isTruncated: false,
      originalLength: output.length,
      canExpand: output.length > maxLength,
      previewUsed: false
    }
  }

  const result = truncateOutput(output, maxLength)
  if (!result.isTruncated) {
    return {
      ...result,
      canExpand: false,
      previewUsed: false
    }
  }

  return {
    data: buildPreview(output),
    isTruncated: true,
    originalLength: result.originalLength,
    canExpand: true,
    previewUsed: true
  }
}

export function ExpandableTruncatedText({ output, maxLength, className, render }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const value = output ?? ''
  const resolvedMax = maxLength ?? 50000

  const result = useMemo(() => buildTruncateResult(value, expanded, resolvedMax), [value, expanded, resolvedMax])

  if (!value) return null

  return (
    <div className={className}>
      {render(result.data)}
      {result.previewUsed && <TruncatedIndicator originalLength={result.originalLength} />}
      {result.canExpand && (
        <Button
          className="mt-2"
          size="small"
          type="link"
          onClick={() => setExpanded((prev) => !prev)}
          style={{ paddingInline: 0 }}>
          {expanded
            ? t('common.collapse', { defaultValue: 'Collapse' })
            : t('common.expand', { defaultValue: 'View full output' })}
        </Button>
      )}
    </div>
  )
}
