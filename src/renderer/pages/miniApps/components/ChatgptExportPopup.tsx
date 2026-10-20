import type { WebviewTag } from 'electron'
import type { TFunction } from 'i18next'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  ChatgptExportError,
  type ChatgptWorkspace,
  detectChatgptWorkspaces,
  exportChatgptConversations,
  importChatgptConversations,
  isValidWorkspaceId
} from '@renderer/services/chatgptExport'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'

const logger = loggerService.withContext('ChatgptExportPopup')

type Step =
  | { kind: 'detecting' }
  | { kind: 'choose'; workspaces: ChatgptWorkspace[] }
  | { kind: 'listing' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'importing'; percent: number }
  | { kind: 'done'; topics: number; messages: number; failed: number }
  | { kind: 'empty'; failed: number }
  | { kind: 'error'; reason: unknown }

interface OwnProps {
  webview: WebviewTag
}

type Props = OwnProps & PopupInjectedProps<void>

function describeError(reason: unknown, t: TFunction): string {
  const code = reason instanceof ChatgptExportError ? reason.code : undefined
  if (code === 'not_signed_in') return t('miniApp.chatgpt_export.error.not_signed_in')
  if (code === 'wrong_page') return t('miniApp.chatgpt_export.error.wrong_page')
  const detail = code ?? (reason instanceof Error ? reason.message : String(reason))
  return t('miniApp.chatgpt_export.error.failed', { reason: detail })
}

const PopupContainer: React.FC<Props> = ({ open, resolve, webview }) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>({ kind: 'detecting' })
  const [mode, setMode] = useState<'personal' | 'team'>('personal')
  const [workspaceId, setWorkspaceId] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    detectChatgptWorkspaces(webview)
      .then((workspaces) => {
        if (!active) return
        setWorkspaceId(workspaces[0]?.id ?? '')
        setStep({ kind: 'choose', workspaces })
      })
      .catch((error: unknown) => {
        if (!active) return
        logger.warn('ChatGPT sign-in check failed', error as Error)
        setStep({ kind: 'error', reason: error })
      })
    return () => {
      active = false
    }
  }, [webview])

  const trimmedWorkspaceId = workspaceId.trim()
  const canStart = mode === 'personal' || isValidWorkspaceId(trimmedWorkspaceId)

  const handleStart = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    try {
      const exported = await exportChatgptConversations(webview, {
        workspaceId: mode === 'team' ? trimmedWorkspaceId : null,
        signal,
        onProgress: (progress) =>
          setStep(progress.phase === 'listing' ? { kind: 'listing' } : { kind: 'downloading', ...progress })
      })
      if (exported.conversations.length === 0) {
        setStep({ kind: 'empty', failed: exported.failedCount })
        return
      }

      setStep({ kind: 'importing', percent: 0 })
      const result = await importChatgptConversations(exported.conversations, (percent) =>
        setStep({ kind: 'importing', percent })
      )
      setStep(
        result.success
          ? { kind: 'done', topics: result.topicsCount, messages: result.messagesCount, failed: exported.failedCount }
          : { kind: 'error', reason: result.error || t('import.chatgpt.error.unknown') }
      )
    } catch (error) {
      if (signal.aborted) return
      logger.error('ChatGPT export failed', error as Error)
      setStep({ kind: 'error', reason: error })
    }
  }

  // Importing writes topics one by one; closing then would leave a half-imported assistant.
  const close = () => {
    if (step.kind === 'importing') return
    abortRef.current?.abort()
    resolve()
  }

  const progress =
    step.kind === 'downloading'
      ? {
          label: t('miniApp.chatgpt_export.downloading', { done: step.done, total: step.total }),
          percent: step.total ? Math.round((step.done / step.total) * 100) : 0
        }
      : step.kind === 'importing'
        ? { label: t('import.chatgpt.importing'), percent: step.percent }
        : null
  const finished = step.kind === 'done' || step.kind === 'empty' || step.kind === 'error'

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent closeOnOverlayClick={false} showCloseButton={step.kind !== 'importing'}>
        <DialogHeader>
          <DialogTitle>{t('miniApp.chatgpt_export.title')}</DialogTitle>
          <DialogDescription>{t('miniApp.chatgpt_export.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex w-full flex-col gap-3">
          {(step.kind === 'detecting' || step.kind === 'listing') && (
            <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm" role="status">
              <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
              <span>
                {step.kind === 'detecting'
                  ? t('miniApp.chatgpt_export.detecting')
                  : t('miniApp.chatgpt_export.listing')}
              </span>
            </div>
          )}

          {step.kind === 'choose' && (
            <>
              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value === 'team' ? 'team' : 'personal')}
                aria-label={t('miniApp.chatgpt_export.workspace.label')}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="personal" id="chatgpt-export-personal" />
                  <Label htmlFor="chatgpt-export-personal">{t('miniApp.chatgpt_export.workspace.personal')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="team" id="chatgpt-export-team" />
                  <Label htmlFor="chatgpt-export-team">{t('miniApp.chatgpt_export.workspace.team')}</Label>
                </div>
              </RadioGroup>
              {mode === 'team' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="chatgpt-export-workspace-id">{t('miniApp.chatgpt_export.workspace.id')}</Label>
                  <Input
                    id="chatgpt-export-workspace-id"
                    value={workspaceId}
                    onChange={(event) => setWorkspaceId(event.target.value)}
                    placeholder={t('miniApp.chatgpt_export.workspace.id_placeholder')}
                    aria-invalid={trimmedWorkspaceId !== '' && !canStart}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {step.workspaces.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
                      <span>{t('miniApp.chatgpt_export.workspace.detected')}</span>
                      {step.workspaces.map((workspace) => (
                        <Button
                          key={workspace.id}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setWorkspaceId(workspace.id)}>
                          {workspace.name ? `${workspace.name} (${workspace.id})` : workspace.id}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {t('miniApp.chatgpt_export.workspace.none_detected')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {progress && (
            <div className="flex flex-col gap-2 py-2">
              <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
                <span>{progress.label}</span>
                <span className="tabular-nums">{progress.percent}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label={progress.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}>
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {step.kind === 'done' && (
            <Alert
              type="success"
              showIcon
              message={t('import.chatgpt.success', { topics: step.topics, messages: step.messages })}
            />
          )}
          {step.kind === 'empty' && step.failed === 0 && (
            <Alert type="info" showIcon message={t('miniApp.chatgpt_export.empty')} />
          )}
          {(step.kind === 'done' || step.kind === 'empty') && step.failed > 0 && (
            <Alert type="warning" showIcon message={t('miniApp.chatgpt_export.failed_count', { count: step.failed })} />
          )}
          {step.kind === 'error' && <Alert type="error" showIcon message={describeError(step.reason, t)} />}
        </div>

        <DialogFooter>
          {step.kind === 'choose' ? (
            <>
              <Button variant="outline" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button variant="emphasis" disabled={!canStart} onClick={handleStart}>
                {t('miniApp.chatgpt_export.start')}
              </Button>
            </>
          ) : (
            <Button variant="outline" disabled={step.kind === 'importing'} onClick={close}>
              {finished ? t('common.close') : t('common.cancel')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ChatgptExportPopup = createPopup<OwnProps, void>(PopupContainer)

export default ChatgptExportPopup
