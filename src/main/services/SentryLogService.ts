import { BaseService, Conditional, DependsOn, Injectable, Phase, ServicePhase, when } from '@main/core/lifecycle'
import { FORK_SENTRY_ENABLED } from '@shared/utils/forkFeatures'

@Injectable('SentryLogService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['PreferenceService'])
@Conditional(when(() => FORK_SENTRY_ENABLED, 'FORK_SENTRY_ENABLED'))
export class SentryLogService extends BaseService {
  protected async onInit(): Promise<void> {
    if (import.meta.env.DEV) return
    const { attachSentryLogTransport } = await import('./sentry')
    this.registerDisposable(attachSentryLogTransport())
  }
}
