import { loggerService } from '@logger'

const logger = loggerService.withContext('HiddenPageUnloader')

export interface HiddenPageTracker {
  /** Starts the hidden clock of `key`, or keeps it running if it already started. */
  hide(key: string, unload: () => void, isBusy?: () => boolean): void
  /** Stops tracking `key`: it is visible again or already gone. */
  show(key: string): void
}

interface HiddenPage {
  hiddenSince: number
  unload: () => void
  isBusy?: () => boolean
}

/**
 * Unloads web pages (mini apps, browser tabs, agent browsers) that stayed hidden longer than
 * the `app.memory.unload_hidden_pages_minutes` preference. One timer per window, armed only
 * while a tracked page is hidden. A busy page (an agent turn still using it) is re-checked
 * one full timeout after it was found busy.
 */
export class HiddenPageUnloader implements HiddenPageTracker {
  private readonly pages = new Map<string, HiddenPage>()
  private timeoutMs = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  /** 0 keeps hidden pages loaded. */
  setTimeoutMinutes(minutes: number): void {
    this.timeoutMs = Math.max(0, minutes) * 60_000
    this.schedule()
  }

  hide(key: string, unload: () => void, isBusy?: () => boolean): void {
    const existing = this.pages.get(key)
    this.pages.set(key, { hiddenSince: existing?.hiddenSince ?? Date.now(), unload, isBusy })
    if (!existing) this.schedule()
  }

  show(key: string): void {
    if (this.pages.delete(key)) this.schedule()
  }

  private schedule(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.timeoutMs === 0 || this.pages.size === 0) return
    const earliest = Math.min(...Array.from(this.pages.values(), (page) => page.hiddenSince))
    this.timer = setTimeout(() => this.sweep(), Math.max(0, earliest + this.timeoutMs - Date.now()))
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, page] of this.pages) {
      if (now - page.hiddenSince < this.timeoutMs) continue
      if (page.isBusy?.()) {
        page.hiddenSince = now
        continue
      }
      this.pages.delete(key)
      logger.info('Unloading a hidden page', { key })
      page.unload()
    }
    this.schedule()
  }
}

export const hiddenPageUnloader = new HiddenPageUnloader()
