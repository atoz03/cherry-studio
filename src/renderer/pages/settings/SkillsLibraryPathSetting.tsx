import { FolderOpen } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'

const logger = loggerService.withContext('SkillsLibraryPathSetting')

/**
 * Fork: picker for the local skills library (`feature.skills.library_path`). Main lists the
 * folder's skills under "Import from system" and scans it only while that dialog runs discovery.
 */
export function SkillsLibraryPathSetting() {
  const { t } = useTranslation()
  const [libraryPath, setLibraryPath] = usePreference('feature.skills.library_path')

  const handleChoose = useCallback(async () => {
    try {
      const selected: string | null | undefined = await window.api.select({
        properties: ['openDirectory', 'createDirectory'],
        title: t('settings.skills.library.select_title')
      })
      if (selected) await setLibraryPath(selected)
    } catch (error) {
      logger.error('Failed to choose the skills library folder', error as Error)
    }
  }, [setLibraryPath, t])

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <FolderOpen size={14} className="shrink-0" aria-hidden />
        <span className="shrink-0">{t('settings.skills.library.label')}</span>
        <span className="min-w-0 truncate text-foreground" title={libraryPath ?? undefined}>
          {libraryPath || t('settings.skills.library.not_set')}
        </span>
        <Button variant="ghost" size="sm" className="h-6 shrink-0 px-2" onClick={() => void handleChoose()}>
          {t('common.browse')}
        </Button>
        {libraryPath ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2"
            aria-label={t('settings.skills.library.clear')}
            onClick={() => void setLibraryPath(null)}>
            {t('common.clear')}
          </Button>
        ) : null}
      </div>
      <span>{t('settings.skills.library.description')}</span>
    </div>
  )
}
