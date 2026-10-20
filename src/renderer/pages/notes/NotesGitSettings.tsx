import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Switch } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import Selector from '@renderer/components/Selector'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import {
  NOTES_GIT_COMMIT_INTERVAL_OPTIONS,
  type NotesGitStatus,
  type NotesGitUnavailableReason
} from '@shared/types/notesGit'

const logger = loggerService.withContext('NotesGitSettings')

const UNAVAILABLE_KEYS = {
  disabled: 'notes.git.status.disabled',
  notes_path_missing: 'notes.git.status.notes_path_missing',
  notes_path_invalid: 'notes.git.status.notes_path_invalid',
  git_not_found: 'notes.git.status.git_not_found',
  nested_repository: 'notes.git.status.nested_repository',
  repository_error: 'notes.git.status.repository_error'
} as const satisfies Record<NotesGitUnavailableReason, string>

/** Settings group for notes git versioning (v1 fork feature). */
const NotesGitSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [enabled, setEnabled] = usePreference('feature.notes.git.enabled')
  const [intervalMinutes, setIntervalMinutes] = usePreference('feature.notes.git.commit_interval_minutes')
  const [notesPath] = usePreference('feature.notes.path')
  const [status, setStatus] = useState<NotesGitStatus | null>(null)

  useEffect(() => {
    setStatus(null)
    if (!enabled) return
    let cancelled = false
    ipcApi
      .request('notes.git.get_status')
      .then((result) => !cancelled && setStatus(result))
      .catch((error) => logger.warn('Failed to read notes git status', error as Error))
    return () => {
      cancelled = true
    }
  }, [enabled, notesPath])

  const statusText = !status
    ? null
    : status.available
      ? t(status.repository === 'existing' ? 'notes.git.status.existing' : 'notes.git.status.none')
      : t(UNAVAILABLE_KEYS[status.reason])

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('notes.git.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('notes.git.enable')}</SettingRowTitle>
        <Switch checked={enabled} onCheckedChange={(checked) => void setEnabled(checked)} />
      </SettingRow>
      <SettingHelpText>{t('notes.git.description')}</SettingHelpText>
      {statusText && (
        <SettingHelpText className={status?.available ? undefined : 'text-destructive'}>{statusText}</SettingHelpText>
      )}
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('notes.git.interval.title')}</SettingRowTitle>
        <Selector
          disabled={!enabled}
          options={NOTES_GIT_COMMIT_INTERVAL_OPTIONS.map((minutes) => ({
            label: t('notes.git.interval.option', { minutes }),
            value: minutes
          }))}
          value={intervalMinutes}
          onChange={(value: number) => void setIntervalMinutes(value)}
        />
      </SettingRow>
      <SettingHelpText>{t('notes.git.interval.description')}</SettingHelpText>
    </SettingGroup>
  )
}

export default NotesGitSettings
