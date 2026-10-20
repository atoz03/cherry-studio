import { ArrowLeft } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useDoctorController } from '@renderer/hooks/doctor'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { POPUP_EXIT_MS, type PopupInjectedProps } from '@renderer/services/popup'
import type { DoctorNavigateTarget, DoctorRunTier } from '@shared/types/doctor'
import type { DoctorPanel } from '@shared/utils/doctor'

import { DoctorChecksPanel } from './DoctorChecksPanel'

const DiagnosticBundlePanel = lazy(() => import('@renderer/components/feedback/DiagnosticBundlePanel'))
const PANEL_DESCRIPTION_KEYS = {
  checks: 'settings.doctor.panel_descriptions.checks',
  export: 'settings.doctor.panel_descriptions.export'
} as const satisfies Record<DoctorPanel, string>
const PANEL_TITLE_KEYS = {
  checks: 'settings.doctor.title',
  export: 'settings.doctor.panels.export'
} as const satisfies Record<DoctorPanel, string>

export interface DoctorDialogParams {
  readonly initialPanel: DoctorPanel
  readonly initialRunTier?: DoctorRunTier
}

type DoctorDialogProps = DoctorDialogParams & PopupInjectedProps<Record<string, never>>

export function DoctorDialog({ initialPanel, initialRunTier, open, resolve }: DoctorDialogProps) {
  const { t } = useTranslation()
  const panelHeadingRef = useRef<HTMLDivElement>(null)
  const canReturnToChecks = initialPanel === 'checks'

  const navigate = useCallback(
    (target: DoctorNavigateTarget) => {
      resolve({})
      window.setTimeout(() => openSettingsTab(target), POPUP_EXIT_MS)
    },
    [resolve]
  )
  const controller = useDoctorController({
    subject: { kind: 'global' },
    initialPanel,
    initialRunTier,
    onNavigate: navigate
  })
  const { setPanelInteraction } = controller
  const isExportPanel = controller.session.activePanel === 'export'

  const close = useCallback(() => {
    if (!controller.isCloseBlocked) resolve({})
  }, [controller.isCloseBlocked, resolve])

  const setBundleBusy = useCallback(
    (busy: boolean) => setPanelInteraction('bundle-operation', busy),
    [setPanelInteraction]
  )
  const finishSecondaryPanel = useCallback(() => {
    if (canReturnToChecks) {
      controller.setPanel('checks')
      return
    }
    resolve({})
  }, [canReturnToChecks, controller, resolve])

  const panelTitle = t(PANEL_TITLE_KEYS[controller.session.activePanel])
  const panelDescription = t(PANEL_DESCRIPTION_KEYS[controller.session.activePanel])

  useEffect(() => {
    panelHeadingRef.current?.focus()
  }, [controller.session.activePanel])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent
        {...(!isExportPanel ? { 'aria-describedby': undefined } : {})}
        size="xl"
        closeLabel={t('common.close')}
        closeOnOverlayClick={!controller.isCloseBlocked}
        showCloseButton={!controller.isCloseBlocked}
        className="grid max-h-[calc(100vh-100px)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (controller.isCloseBlocked) event.preventDefault()
        }}>
        <DialogHeader
          className={cn('flex-row items-start gap-3 px-6 pt-6 pr-12 pb-4', isExportPanel && 'border-b border-border')}>
          {controller.session.activePanel !== 'checks' && canReturnToChecks ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.doctor.actions.back_to_checks')}
              disabled={!controller.canChangePanel}
              onClick={() => controller.setPanel('checks')}>
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
          ) : null}
          <div ref={panelHeadingRef} tabIndex={-1} className="min-w-0 flex-1 space-y-1">
            <DialogTitle>{panelTitle}</DialogTitle>
            {isExportPanel ? <DialogDescription>{panelDescription}</DialogDescription> : null}
          </div>
        </DialogHeader>

        <div hidden={controller.session.activePanel !== 'checks'} className="contents">
          <DoctorChecksPanel controller={controller} />
        </div>

        {controller.session.activePanel === 'export' ? (
          <Suspense fallback={<PanelLoading />}>
            <DiagnosticBundlePanel
              appVersion={controller.viewModel.report?.basics.version ?? ''}
              onBusyChange={setBundleBusy}
              onClose={finishSecondaryPanel}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function PanelLoading() {
  const { t } = useTranslation()
  return (
    <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm" role="status">
      {t('common.loading')}
    </div>
  )
}
