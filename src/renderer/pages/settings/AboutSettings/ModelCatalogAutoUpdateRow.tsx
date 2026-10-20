import { useTranslation } from 'react-i18next'

import { Divider, InfoTooltip, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'

/**
 * Fork setting: switches the background model-catalog download (ProviderRegistryUpdaterService)
 * on or off. Shown next to app auto update because both are periodic downloads.
 */
export function ModelCatalogAutoUpdateRow() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePreference('app.provider_registry.auto_update.enabled')
  const title = t('settings.general.model_catalog_auto_update.title')
  const description = t('settings.general.model_catalog_auto_update.tip')

  return (
    <>
      <Divider className="my-3" />
      <SettingRow id="setting-about-model-catalog-auto-update" className="scroll-mt-6 gap-3">
        <SettingRowTitle className="gap-1">
          {title}
          <InfoTooltip
            content={description}
            ariaLabel={`${title}: ${description}`}
            iconProps={{ className: 'cursor-pointer' }}
          />
        </SettingRowTitle>
        <Switch aria-label={title} checked={enabled} onCheckedChange={(v) => setEnabled(v)} />
      </SettingRow>
    </>
  )
}
