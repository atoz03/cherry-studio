import { useTranslation } from 'react-i18next'

import { InfoTooltip, InputNumber } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'
import { TAB_LIMITS } from '@renderer/services/TabLruManager'

/** Fork setting: how many tabs stay loaded before the least recently used ones are unloaded. */
export function TabKeepAliveRow() {
  const { t } = useTranslation()
  const [limit, setLimit] = usePreference('ui.tab.keep_alive_limit')
  const title = t('settings.general.tab_keep_alive.title')
  const description = t('settings.general.tab_keep_alive.tip')

  return (
    <>
      <SettingDivider />
      <SettingRow id="setting-general-tab-keep-alive" className="scroll-mt-6">
        <SettingRowTitle className="gap-1">
          {title}
          <InfoTooltip content={description} ariaLabel={`${title}: ${description}`} />
        </SettingRowTitle>
        <div className="w-[220px] shrink-0">
          <InputNumber
            min={1}
            max={TAB_LIMITS.hardCap}
            step={1}
            className="h-8 rounded-lg px-2.5"
            aria-label={title}
            value={limit}
            onBlur={(value) => void setLimit(value ?? limit)}
          />
        </div>
      </SettingRow>
    </>
  )
}
