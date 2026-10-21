import { SquareTerminal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConversationPickerDialog, type ConversationPickerItem } from '@renderer/components/resourceCatalog/selectors'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { AbsoluteFilePathSchema } from '@shared/types/file'

type PiSessionSummary = Awaited<ReturnType<typeof listPiSessions>>[number]
type PiSessionItem = ConversationPickerItem & { session: PiSessionSummary; title: string }

const listPiSessions = () => ipcApi.request('ai.agent.pi_session.list')

function sessionTitle(session: PiSessionSummary): string {
  return (session.name ?? session.firstMessage.split('\n', 1)[0]).trim().slice(0, 100)
}

interface ImportPiSessionPopupParams {
  agentId: string
}

/** Pick one of the user's pi CLI sessions and open it in a Pi agent; resolves to the Cherry session id. */
function ImportPiSessionDialog({
  agentId,
  open,
  resolve
}: ImportPiSessionPopupParams & PopupInjectedProps<string | undefined>) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<PiSessionSummary[]>()

  useEffect(() => {
    listPiSessions().then(setSessions, (error) => {
      toast.error({ title: t('agent.session.import_pi.failed'), description: formatErrorMessage(error) })
      setSessions([])
    })
  }, [t])

  const items = useMemo<PiSessionItem[]>(
    () =>
      (sessions ?? []).map((session) => {
        const title = sessionTitle(session)
        const folder = session.cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? session.cwd
        return {
          id: session.sessionId,
          name: `${title} — ${folder}`,
          icon: <SquareTerminal />,
          searchText: `${session.firstMessage} ${session.cwd}`,
          session,
          title
        }
      }),
    [sessions]
  )

  const handleSelect = async ({ session, title }: PiSessionItem) => {
    try {
      const { sessionId } = await ipcApi.request('ai.agent.pi_session.import', {
        agentId,
        piSessionId: session.sessionId,
        cwd: AbsoluteFilePathSchema.parse(session.cwd),
        name: title
      })
      resolve(sessionId)
    } catch (error) {
      toast.error({ title: t('agent.session.import_pi.failed'), description: formatErrorMessage(error) })
    }
  }

  return (
    <ConversationPickerDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resolve(undefined)
      }}
      items={items}
      isLoading={!sessions}
      pageSize={50}
      labels={{
        title: t('agent.session.import_pi.title'),
        description: t('agent.session.import_pi.description'),
        searchPlaceholder: t('agent.session.import_pi.search'),
        emptyText: t('agent.session.import_pi.empty'),
        loadingText: t('common.loading')
      }}
      onSelect={handleSelect}
    />
  )
}

export const importPiSessionPopup = createPopup<ImportPiSessionPopupParams, string | undefined>(ImportPiSessionDialog, {
  dismissResult: undefined
})
