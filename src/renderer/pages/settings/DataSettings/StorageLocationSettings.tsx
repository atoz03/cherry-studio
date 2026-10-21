import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, RowFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  SettingDivider,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingSubtitle
} from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { StorageLocation, StorageLocationInfo } from '@shared/types/storageLocation'

import { formatCacheCleanupSize } from './ClearCachePopup'
import { relocationValidationMessageKey } from './relocationValidation'

const logger = loggerService.withContext('StorageLocationSettings')

/**
 * Settings → Data rows for the storage locations that can move out of the app
 * data directory. A change only records the move: the data moves on the
 * restart that follows, before the app opens.
 */
const StorageLocationSettings: React.FC = () => {
  const { t } = useTranslation()
  const [locations, setLocations] = useState<StorageLocationInfo[]>()

  useEffect(() => {
    let cancelled = false
    void ipcApi
      .request('app.storage_location.list')
      .then((result) => {
        if (!cancelled) setLocations(result)
      })
      .catch((error) => logger.warn('Failed to list storage locations', error as Error))
    return () => {
      cancelled = true
    }
  }, [])

  const labels: Record<StorageLocation, string> = {
    models: t('settings.data.storage_locations.models.label'),
    toolchain: t('settings.data.storage_locations.toolchain.label'),
    session_data: t('settings.data.storage_locations.session_data.label')
  }
  const descriptions: Record<StorageLocation, string> = {
    models: t('settings.data.storage_locations.models.description'),
    toolchain: t('settings.data.storage_locations.toolchain.description'),
    session_data: t('settings.data.storage_locations.session_data.description')
  }

  const moveTo = async (info: StorageLocationInfo, target: string) => {
    const inspection = await ipcApi.request('app.storage_location.inspect', { location: info.location, path: target })
    if (!inspection.valid) {
      toast.error(t(relocationValidationMessageKey(inspection.reason)))
      return
    }

    const confirmed = await popup.confirm({
      title: t('settings.data.storage_locations.confirm_title', { name: labels[info.location] }),
      width: 'min(560px, 90vw)',
      content: (
        <div className="flex flex-col gap-4 py-2 text-sm">
          <MovePath label={t('settings.data.app_data.original_path')} value={info.path} />
          <MovePath label={t('settings.data.app_data.new_path')} value={target} />
          <p className="text-warning">{t('settings.data.storage_locations.restart_notice')}</p>
          {info.location === 'toolchain' && (
            <p className="text-muted-foreground">{t('settings.data.storage_locations.toolchain.python_notice')}</p>
          )}
        </div>
      ),
      centered: true,
      okText: t('common.confirm'),
      cancelText: t('common.cancel')
    })
    if (!confirmed) return

    try {
      await ipcApi.request('app.storage_location.request', { location: info.location, path: target })
      toast.info({ title: t('settings.data.storage_locations.restarting'), timeout: 2000 })
      window.setTimeout(() => {
        void ipcApi.request('app.relaunch')
      }, 500)
    } catch (error) {
      logger.error('Failed to request a storage location change', error as Error)
      toast.error(t('settings.data.storage_locations.change_failed'))
    }
  }

  const handleChange = async (info: StorageLocationInfo) => {
    const target = await window.api.file.selectFolder({
      title: t('settings.data.storage_locations.select_title', { name: labels[info.location] }),
      properties: ['openDirectory', 'createDirectory']
    })
    if (target) await moveTo(info, target)
  }

  const openPath = (path: string) => void ipcApi.request('system.shell.open_path', path)

  return (
    <>
      <SettingDivider />
      <SettingRow id="setting-data-data-storage-locations" className="scroll-mt-6">
        <SettingSubtitle>{t('settings.data.storage_locations.title')}</SettingSubtitle>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.storage_locations.help')}</SettingHelpText>
      </SettingRow>
      {locations?.map((info) => (
        <div key={info.location}>
          <SettingDivider />
          <SettingRow id={`setting-data-storage-${info.location}`}>
            <SettingRowTitle>
              {labels[info.location]}
              {info.bytes !== null && (
                <span className="ml-1.25 text-foreground-tertiary text-xs">({formatCacheCleanupSize(info.bytes)})</span>
              )}
            </SettingRowTitle>
            <RowFlex className="ml-2 gap-1.25">
              <Button onClick={() => openPath(info.path)} variant="outline">
                {t('common.open')}
              </Button>
              <Button onClick={() => void handleChange(info)} variant="outline">
                {t('settings.data.storage_locations.change')}
              </Button>
              {!info.isDefault && (
                <Button onClick={() => void moveTo(info, info.defaultPath)} variant="outline">
                  {t('common.reset')}
                </Button>
              )}
            </RowFlex>
          </SettingRow>
          <SettingRow>
            <div className="flex min-w-0 flex-col gap-1">
              <SettingHelpText>{descriptions[info.location]}</SettingHelpText>
              {/* Full path on its own line: knowing where the data lives is the point of this group. */}
              <SettingHelpText
                className="cursor-pointer break-all hover:text-foreground"
                onClick={() => openPath(info.path)}>
                {info.path}
              </SettingHelpText>
            </div>
          </SettingRow>
        </div>
      ))}
    </>
  )
}

const MovePath = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-1.25">
    <div className="font-semibold text-foreground">{label}</div>
    <div className="break-all rounded border border-border bg-background-subtle px-3 py-2 text-muted-foreground text-sm">
      {value}
    </div>
  </div>
)

export default StorageLocationSettings
