import type { WebviewTag } from 'electron'
import { Download } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { isChatgptExportSupported } from '@renderer/services/chatgptExport'
import type { MiniApp } from '@shared/data/types/miniApp'

interface Props {
  app: MiniApp
  webview: WebviewTag | null
  className?: string
}

/** Toolbar action of the built-in ChatGPT mini app; renders nothing for any other app. */
const ChatgptExportButton: FC<Props> = ({ app, webview, className }) => {
  const { t } = useTranslation()
  if (!isChatgptExportSupported(app)) return null

  return (
    <Tooltip content={t('miniApp.chatgpt_export.button')} placement="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!webview}
        onClick={async () => {
          if (!webview) return
          const { default: ChatgptExportPopup } = await import('./ChatgptExportPopup')
          void ChatgptExportPopup.show({ webview })
        }}
        className={className}
        aria-label={t('miniApp.chatgpt_export.button')}>
        <Download size={14} />
      </Button>
    </Tooltip>
  )
}

export default ChatgptExportButton
