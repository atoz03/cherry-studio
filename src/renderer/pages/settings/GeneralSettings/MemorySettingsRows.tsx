import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { InfoTooltip, InputNumber, Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingDivider, SettingRow, SettingRowTitle } from '@renderer/components/SettingsPrimitives'

const MAX_MINI_APPS_KEPT = 10
const MAX_UNLOAD_MINUTES = 1440

function MemoryRow({ id, title, tip, children }: { id: string; title: string; tip: string; children: ReactNode }) {
  return (
    <>
      <SettingDivider />
      <SettingRow id={`setting-general-${id}`} className="scroll-mt-6">
        <SettingRowTitle className="gap-1">
          {title}
          <InfoTooltip content={tip} ariaLabel={`${title}: ${tip}`} />
        </SettingRowTitle>
        {children}
      </SettingRow>
    </>
  )
}

/** Fork settings that trade reload time for memory: hidden pages, idle runtimes and hidden windows. */
export function MemorySettingsRows() {
  const { t } = useTranslation()
  const [countsPinned, setCountsPinned] = usePreference('ui.tab.keep_alive_counts_pinned')
  const [miniAppsKept, setMiniAppsKept] = usePreference('feature.mini_app.max_keep_alive')
  const [unloadMinutes, setUnloadMinutes] = usePreference('app.memory.unload_hidden_pages_minutes')
  const [releaseRuntimes, setReleaseRuntimes] = usePreference('app.memory.release_idle_runtimes')
  const [throttleWindows, setThrottleWindows] = usePreference('app.memory.throttle_hidden_windows')

  const pinnedTitle = t('settings.general.memory.pinned_tabs.title')
  const miniAppsTitle = t('settings.miniApps.cache_title')
  const unloadTitle = t('settings.general.memory.unload_hidden_pages.title')
  const runtimesTitle = t('settings.general.memory.release_idle_runtimes.title')
  const throttleTitle = t('settings.general.memory.throttle_hidden_windows.title')

  return (
    <>
      <MemoryRow id="pinned-tabs-keep-alive" title={pinnedTitle} tip={t('settings.general.memory.pinned_tabs.tip')}>
        <Switch
          aria-label={pinnedTitle}
          checked={countsPinned}
          onCheckedChange={(checked) => void setCountsPinned(checked)}
        />
      </MemoryRow>
      <MemoryRow id="mini-app-keep-alive" title={miniAppsTitle} tip={t('settings.miniApps.cache_description')}>
        <div className="w-[220px] shrink-0">
          <InputNumber
            min={1}
            max={MAX_MINI_APPS_KEPT}
            step={1}
            className="h-8 rounded-lg px-2.5"
            aria-label={miniAppsTitle}
            value={miniAppsKept}
            onBlur={(value) => void setMiniAppsKept(value ?? miniAppsKept)}
          />
        </div>
      </MemoryRow>
      <MemoryRow
        id="unload-hidden-pages"
        title={unloadTitle}
        tip={t('settings.general.memory.unload_hidden_pages.tip')}>
        <div className="w-[220px] shrink-0">
          <InputNumber
            min={0}
            max={MAX_UNLOAD_MINUTES}
            step={1}
            className="h-8 rounded-lg px-2.5"
            aria-label={unloadTitle}
            value={unloadMinutes}
            onBlur={(value) => void setUnloadMinutes(value ?? unloadMinutes)}
          />
        </div>
      </MemoryRow>
      <MemoryRow
        id="release-idle-runtimes"
        title={runtimesTitle}
        tip={t('settings.general.memory.release_idle_runtimes.tip')}>
        <Switch
          aria-label={runtimesTitle}
          checked={releaseRuntimes}
          onCheckedChange={(checked) => void setReleaseRuntimes(checked)}
        />
      </MemoryRow>
      <MemoryRow
        id="throttle-hidden-windows"
        title={throttleTitle}
        tip={t('settings.general.memory.throttle_hidden_windows.tip')}>
        <Switch
          aria-label={throttleTitle}
          checked={throttleWindows}
          onCheckedChange={(checked) => void setThrottleWindows(checked)}
        />
      </MemoryRow>
    </>
  )
}
