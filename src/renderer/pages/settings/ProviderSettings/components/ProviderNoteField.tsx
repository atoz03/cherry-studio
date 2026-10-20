import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'

import ProviderField from '../primitives/ProviderField'

const logger = loggerService.withContext('ProviderNoteField')

/** The provider's notes (`settings.notes`, shared with the Model Notes drawer), edited in place and saved on blur. */
export default function ProviderNoteField({ providerId }: { providerId: string }) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const savedNotes = provider?.settings?.notes ?? ''
  const [notes, setNotes] = useState(savedNotes)

  useEffect(() => setNotes(savedNotes), [savedNotes])

  const save = async () => {
    if (!provider || notes === savedNotes) return
    try {
      await updateProvider({ providerSettings: { ...provider.settings, notes } })
    } catch (error) {
      logger.error('Failed to save provider notes', { providerId, error })
      toast.error(t('blocks.edit.save.failed.label'))
    }
  }

  return (
    <ProviderField title={t('settings.provider.note.label')}>
      <Textarea.Input
        aria-label={t('settings.provider.note.label')}
        className="field-sizing-content min-h-9 w-full text-sm"
        rows={1}
        spellCheck={false}
        value={notes}
        placeholder={t('settings.provider.note.placeholder')}
        onValueChange={setNotes}
        onBlur={() => void save()}
      />
    </ProviderField>
  )
}
