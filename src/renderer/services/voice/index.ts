export { VoiceDomainError, voiceService } from './VoiceService'
export { getDefaultVoiceLanguage } from './voiceLanguage'
export { voiceTargetManager } from './VoiceTargetManager'
export type {
  CapturedVoiceTarget,
  VoiceReplaceRange,
  VoiceTargetInsertResult,
  VoiceTargetRegistration
} from './VoiceTargetManager'
export type { ReadableTextMode, ReadableTextPlan, ReadableTextTrigger } from './readableText'
export { dictationService } from './DictationService'
export type { DictationErrorCategory, DictationPhase, DictationSnapshot } from './DictationService'
export { speechPlaybackService } from './SpeechPlaybackService'
export type {
  SpeechPlaybackPhase,
  SpeechPlaybackSnapshot,
  SpeechPlaybackSourceLabel,
  SpeechPlaybackStartInput,
  SpeechPlaybackStartResult
} from './SpeechPlaybackService'
export { readMessageAloud } from './messagePlayback'
export type { ReadMessageAloudInput } from './messagePlayback'
export { readTextAloud } from './manualPlayback'
export type { ReadTextAloudInput } from './manualPlayback'
export { autoReadService } from './AutoReadService'
export type { AutoReadCompletion, AutoReadResult } from './AutoReadService'

export { enumerateMicrophones, subscribeMicrophoneChanges } from './microphoneDevices'
export type { MicrophoneDevice } from './microphoneDevices'
