import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox, ConfirmDialog, SelectDropdown } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'

export interface MoveAllTopicsTarget {
  id: string
  label: string
  icon?: ReactNode
}

export interface MoveAllTopicsChoice {
  targetAssistantId: string
  dedupe: boolean
}

interface MoveAllTopicsParams {
  sourceName: string
  targets: MoveAllTopicsTarget[]
  /** Runs behind the confirm spinner; a rejection keeps the dialog open for a retry. */
  action: (choice: MoveAllTopicsChoice) => Promise<void>
}

const TargetLabel = ({ target }: { target: MoveAllTopicsTarget }) => (
  <span className="flex min-w-0 items-center gap-2">
    {target.icon && <span className="flex size-4 shrink-0 items-center justify-center">{target.icon}</span>}
    <span className="truncate">{target.label}</span>
  </span>
)

const MoveAllTopicsDialog = ({
  open,
  resolve,
  sourceName,
  targets,
  action
}: MoveAllTopicsParams & PopupInjectedProps<boolean>) => {
  const { t } = useTranslation()
  const [targetId, setTargetId] = useState('')
  const [dedupe, setDedupe] = useState(true)
  const [running, setRunning] = useState(false)

  const handleConfirm = async () => {
    setRunning(true)
    try {
      await action({ targetAssistantId: targetId, dedupe })
      resolve(true)
    } catch (error) {
      toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
      setRunning(false)
    }
    // The dialog closes through `resolve`, never through ConfirmDialog's own close.
    return false
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && !running && resolve(false)}
      title={t('assistants.move_all.title')}
      description={t('assistants.move_all.description', { from: sourceName })}
      content={
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="font-medium text-muted-foreground text-xs leading-4">{t('assistants.move_all.target')}</div>
            <SelectDropdown
              items={targets}
              selectedId={targetId}
              onSelect={setTargetId}
              placeholder={t('assistants.move_all.placeholder')}
              emptyText={t('assistants.move_all.empty')}
              triggerClassName="h-8 rounded-md border-border-subtle bg-card text-xs shadow-none"
              renderSelected={(target) => <TargetLabel target={target} />}
              renderItem={(target) => <TargetLabel target={target} />}
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={dedupe}
              disabled={running}
              onCheckedChange={(checked) => setDedupe(checked === true)}
            />
            <span className="space-y-0.5">
              <span className="block">{t('assistants.move_all.dedupe')}</span>
              <span className="block text-muted-foreground text-xs">{t('assistants.move_all.dedupe_hint')}</span>
            </span>
          </label>
        </div>
      }
      confirmText={t('assistants.move_all.confirm')}
      cancelText={t('common.cancel')}
      cancelDisabled={running}
      confirmLoading={running}
      confirmDisabled={!targetId}
      onConfirm={handleConfirm}
    />
  )
}

/** Pick a target assistant (and whether to archive duplicates), then run the move in-dialog. */
const MoveAllTopicsPopup = createPopup<MoveAllTopicsParams, boolean>(MoveAllTopicsDialog, { dismissResult: false })

export default MoveAllTopicsPopup
