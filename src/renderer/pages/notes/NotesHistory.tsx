import { History } from 'lucide-react'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ConfirmDialog, EmptyState, PageSidePanel, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import BaseNavbarIcon from '@renderer/components/NavbarIcon'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { notesErrorCodes } from '@shared/ipc/errors/notes'
import type { NotesGitCommit, NotesGitFileDiff } from '@shared/types/notesGit'

const logger = loggerService.withContext('NotesHistory')

interface NotesHistoryProps {
  filePath: string
  /** Persist pending editor edits; rejects when they cannot be saved. */
  flushDraft: () => Promise<void>
  /** Load the restored file into the editor. */
  reloadDraft: () => Promise<void>
}

const fileNameOf = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath

const formatDate = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Classify unified-diff lines; file headers are dropped since the panel already names the file. */
function diffLines(diff: string): Array<{ text: string; kind: 'added' | 'removed' | 'hunk' | 'context' }> {
  return diff
    .split('\n')
    .filter((line) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line))
    .map((text) => ({
      text,
      kind: text.startsWith('+')
        ? 'added'
        : text.startsWith('-')
          ? 'removed'
          : text.startsWith('@@')
            ? 'hunk'
            : 'context'
    }))
}

/** Navbar button + side panel listing a note's git history, its diffs and restore (v1 fork feature). */
const NotesHistory: FC<NotesHistoryProps> = ({ filePath, flushDraft, reloadDraft }) => {
  const { t } = useTranslation()
  const [enabled] = usePreference('feature.notes.git.enabled')
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<NotesGitCommit[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<NotesGitFileDiff | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setHistory(null)
    ipcApi
      .request('notes.git.get_file_history', { path: filePath })
      .then((commits) => {
        if (cancelled) return
        setHistory(commits)
        setSelected((current) => (commits.some((c) => c.hash === current) ? current : (commits[0]?.hash ?? null)))
      })
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to load note history', error as Error)
        toast.error(t('notes.git.history.load_failed'))
        setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [open, filePath, refreshKey, t])

  useEffect(() => {
    if (!open || !selected) {
      setDiff(null)
      return
    }
    let cancelled = false
    setDiff(null)
    ipcApi
      .request('notes.git.get_file_diff', { path: filePath, revision: selected })
      .then((result) => !cancelled && setDiff(result))
      .catch((error) => {
        if (cancelled) return
        logger.error('Failed to load note diff', error as Error)
        toast.error(t('notes.git.history.load_failed'))
      })
    return () => {
      cancelled = true
    }
  }, [open, filePath, selected, refreshKey, t])

  const handleRestore = useCallback(async () => {
    if (!selected) return
    setRestoring(true)
    try {
      try {
        await flushDraft()
      } catch (error) {
        logger.warn('Pending note edits could not be saved before restore', error as Error)
        toast.error(t('notes.git.history.save_failed'))
        return
      }
      await ipcApi.request('notes.git.restore_file', { path: filePath, revision: selected })
      await reloadDraft()
      toast.success(t('notes.git.history.restore_success'))
      setRefreshKey((key) => key + 1)
    } catch (error) {
      logger.error('Failed to restore note version', error as Error)
      const busy = error instanceof IpcError && error.code === notesErrorCodes.GIT_REPOSITORY_BUSY
      toast.error(t(busy ? 'notes.git.history.busy' : 'notes.git.history.restore_failed'))
    } finally {
      setRestoring(false)
    }
  }, [filePath, flushDraft, reloadDraft, selected, t])

  const selectedCommit = history?.find((commit) => commit.hash === selected)
  if (!enabled) return null

  return (
    <>
      <Tooltip title={t('notes.git.history.title')} delay={800}>
        <BaseNavbarIcon aria-label={t('notes.git.history.title')} onClick={() => setOpen(true)}>
          <History size={18} />
        </BaseNavbarIcon>
      </Tooltip>
      <PageSidePanel
        open={open}
        onClose={() => setOpen(false)}
        title={t('notes.git.history.title')}
        closeLabel={t('common.close')}
        contentClassName="w-[min(720px,calc(100%-1.5rem))]"
        bodyClassName="flex min-h-0 flex-col"
        footer={
          <div className="flex justify-end">
            <Button variant="destructive" disabled={!selected || restoring} onClick={() => setConfirmOpen(true)}>
              {t('notes.git.history.restore')}
            </Button>
          </div>
        }>
        {history === null ? (
          <div className="p-4 text-muted-foreground text-sm">{t('common.loading')}</div>
        ) : history.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyState icon={History} title={t('notes.git.history.empty')} compact />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <ul
              className="max-h-48 shrink-0 overflow-auto rounded-md border border-border"
              aria-label={t('notes.git.history.title')}>
              {history.map((commit) => (
                <li key={commit.hash}>
                  <button
                    type="button"
                    aria-current={commit.hash === selected}
                    onClick={() => setSelected(commit.hash)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-accent',
                      commit.hash === selected && 'bg-accent'
                    )}>
                    <span className="truncate">{commit.message || formatDate(commit.date)}</span>
                    <span className="shrink-0 font-mono text-muted-foreground text-xs">{commit.hash.slice(0, 7)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="shrink-0 text-muted-foreground text-xs">{t('notes.git.history.diff_legend')}</p>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background">
              {diff === null ? (
                <div className="p-3 text-muted-foreground text-xs">{t('common.loading')}</div>
              ) : diff.diff.trim() === '' ? (
                <div className="p-3 text-muted-foreground text-sm">{t('notes.git.history.no_changes')}</div>
              ) : (
                <pre className="m-0 p-2 font-mono text-xs leading-5">
                  {diffLines(diff.diff).map((line, index) => (
                    <div
                      key={index}
                      className={cn(
                        'whitespace-pre-wrap break-all px-1',
                        line.kind === 'added' && 'bg-success/10 text-success',
                        line.kind === 'removed' && 'bg-destructive/10 text-destructive',
                        line.kind === 'hunk' && 'text-muted-foreground'
                      )}>
                      {line.text || ' '}
                    </div>
                  ))}
                </pre>
              )}
            </div>
            {diff?.truncated && (
              <p className="shrink-0 text-muted-foreground text-xs">{t('notes.git.history.truncated')}</p>
            )}
          </div>
        )}
      </PageSidePanel>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('notes.git.history.restore_confirm_title')}
        description={t('notes.git.history.restore_confirm_content', {
          fileName: fileNameOf(filePath),
          version: selectedCommit ? `${selectedCommit.message} (${selectedCommit.hash.slice(0, 7)})` : ''
        })}
        confirmText={t('notes.git.history.restore')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={restoring}
        onConfirm={handleRestore}
      />
    </>
  )
}

export default NotesHistory
