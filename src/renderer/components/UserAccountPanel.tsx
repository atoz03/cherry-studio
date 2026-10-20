import { Monitor, Moon, Settings, Sun, SunMoon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarImage, Button, ColFlex, EmojiAvatar, RowFlex, SegmentedControl } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import useAvatar from '@renderer/hooks/useAvatar'
import { useTheme } from '@renderer/hooks/useTheme'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { getAppEdition } from '@renderer/utils/appEdition'
import { isEmoji } from '@renderer/utils/naming'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import UserPopup from './UserPopup'

export function UserAccountPanel({ onRequestClose }: { onRequestClose?: () => void }) {
  const [userName] = usePreference('app.user.name')
  const { t } = useTranslation()
  const avatar = useAvatar()
  const { settedTheme, setTheme } = useTheme()

  const handleOpenAccountDetails = () => {
    onRequestClose?.()
    if (getAppEdition() === 'global') {
      openSettingsTab('/settings/profile')
    } else {
      void UserPopup.show()
    }
  }

  const handleOpenSettings = () => {
    onRequestClose?.()
    openSettingsTab()
  }

  const themeOptions = [
    {
      value: ThemeMode.light,
      label: (
        <>
          <Sun className="size-3" aria-hidden />
          <span className="sr-only">{t('settings.theme.light')}</span>
        </>
      )
    },
    {
      value: ThemeMode.dark,
      label: (
        <>
          <Moon className="size-3" aria-hidden />
          <span className="sr-only">{t('settings.theme.dark')}</span>
        </>
      )
    },
    {
      value: ThemeMode.system,
      label: (
        <>
          <Monitor className="size-3" aria-hidden />
          <span className="sr-only">{t('settings.theme.system')}</span>
        </>
      )
    }
  ]

  return (
    <ColFlex className="w-56 p-1.5">
      <ColFlex className="pb-1">
        <Button
          type="button"
          variant="ghost"
          aria-label={t('settings.general.user_name.label')}
          className="h-auto min-h-9 w-full items-center justify-start gap-2 px-2 py-1 text-left"
          onClick={handleOpenAccountDetails}
          size="sm">
          {isEmoji(avatar) ? (
            <EmojiAvatar size={28} fontSize={14} className="shrink-0">
              {avatar}
            </EmojiAvatar>
          ) : (
            <Avatar className="size-7 shrink-0 rounded-full">
              <AvatarImage src={avatar} className="object-cover" />
            </Avatar>
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-foreground leading-[18px]">
            {userName || t('settings.general.user_name.placeholder')}
          </span>
        </Button>
      </ColFlex>
      <ColFlex className="border-border-subtle gap-0.5 border-t pt-1">
        <Button
          className="min-h-7 w-full justify-start gap-2 px-2 text-[13px] text-foreground leading-5"
          onClick={handleOpenSettings}
          size="sm"
          variant="ghost">
          <Settings className="!text-muted-foreground size-4" aria-hidden />
          {t('common.settings')}
        </Button>
        <RowFlex className="min-h-7 items-center gap-2 px-2">
          <SunMoon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground leading-5">
            {t('settings.appearance.title')}
          </span>
          <SegmentedControl
            aria-label={t('settings.appearance.title')}
            className="p-px [&_[role=radio]]:h-6 [&_[role=radio]]:px-1.5"
            options={themeOptions}
            size="sm"
            value={settedTheme}
            onValueChange={setTheme}
          />
        </RowFlex>
      </ColFlex>
    </ColFlex>
  )
}
