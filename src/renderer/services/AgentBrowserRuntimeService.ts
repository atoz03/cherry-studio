import type { WebviewTag } from 'electron'

import { cacheService } from '@renderer/data/CacheService'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { classifyTurn } from '@shared/ai/transport'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { type HiddenPageTracker, hiddenPageUnloader } from './HiddenPageUnloader'

export interface AgentBrowserResource {
  sessionId: string
  sourceUrl: string
  securityProfile: WebviewSecurityProfile
  anchor: HTMLElement | null
  overlays: HTMLElement | null
  reloadKey?: number | string
  guest: WebviewTag | null
  url: string
  title: string
  ready: boolean
  loading: boolean
  failed: boolean
}

/** Browser instances outlive presentation subscriptions and retain active Agent turns without a tab. */
export class AgentBrowserRuntimeService {
  private readonly owners = new Map<string, Set<string>>()
  private readonly resources = new Map<string, AgentBrowserResource>()
  private readonly listeners = new Set<() => void>()
  private ids: readonly string[] = []
  private readonly turnSubscriptions = new Map<string, () => void>()
  /** Where an unloaded hidden page was, so showing it again reopens that page. */
  private readonly released = new Map<string, { sourceUrl: string; url: string }>()

  constructor(
    private readonly scope: 'agent' | 'topic' = 'agent',
    private readonly hiddenPages?: HiddenPageTracker
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getIds = () => this.ids
  get = (sessionId: string) => this.resources.get(sessionId)

  declare(sessionId: string, ownerTabId: string): void {
    for (const [previousSessionId, previousOwners] of this.owners) {
      if (previousSessionId === sessionId || !previousOwners.delete(ownerTabId)) continue
      this.releaseUnowned(previousSessionId)
    }
    const owners = this.owners.get(sessionId) ?? new Set<string>()
    owners.add(ownerTabId)
    this.owners.set(sessionId, owners)
    this.turnSubscriptions.get(sessionId)?.()
    this.turnSubscriptions.delete(sessionId)
  }

  ensure(sessionId: string, url?: string, profile: WebviewSecurityProfile = WebviewSecurityProfile.AgentBrowser): void {
    if (!this.owners.has(sessionId)) return
    const existing = this.resources.get(sessionId)
    if (existing && !url) return
    const released = this.released.get(sessionId)
    this.released.delete(sessionId)
    const sourceUrl = released && (!url || url === released.sourceUrl) ? released.url : (url ?? 'about:blank')
    const securityProfile = sourceUrl.startsWith('file:') ? WebviewSecurityProfile.AgentHtmlArtifact : profile
    if (existing) {
      if (existing.sourceUrl !== sourceUrl || existing.securityProfile !== securityProfile) {
        this.update(sessionId, { sourceUrl, securityProfile })
      }
      return
    }
    this.resources.set(sessionId, {
      sessionId,
      sourceUrl,
      securityProfile,
      url: sourceUrl,
      title: '',
      anchor: null,
      overlays: null,
      guest: null,
      ready: false,
      loading: true,
      failed: false
    })
    this.ids = [...this.resources.keys()]
    this.trackVisibility(sessionId, null)
    this.emit()
  }

  update(sessionId: string, patch: Partial<Omit<AgentBrowserResource, 'sessionId'>>): void {
    const existing = this.resources.get(sessionId)
    if (
      !existing ||
      Object.entries(patch).every(([key, value]) => existing[key as keyof AgentBrowserResource] === value)
    )
      return
    this.resources.set(sessionId, { ...existing, ...patch })
    if ('anchor' in patch) this.trackVisibility(sessionId, patch.anchor ?? null)
    this.emit()
  }

  private hiddenKey(sessionId: string): string {
    return `${this.scope}-browser:${sessionId}`
  }

  private trackVisibility(sessionId: string, anchor: HTMLElement | null): void {
    if (anchor) {
      this.hiddenPages?.show(this.hiddenKey(sessionId))
      return
    }
    // An agent turn may drive the page while nobody looks at it; keep it until the turn ends.
    const topicId = this.scope === 'agent' ? buildAgentSessionTopicId(sessionId) : sessionId
    this.hiddenPages?.hide(
      this.hiddenKey(sessionId),
      () => this.release(sessionId),
      () => classifyTurn(cacheService.getShared(`topic.stream.statuses.${topicId}`)?.status).isTurnActive
    )
  }

  /** Unloads the page but keeps its owners: the next `ensure` reopens it where it was. */
  private release(sessionId: string): void {
    const resource = this.resources.get(sessionId)
    if (!resource || resource.anchor) return
    this.released.set(sessionId, { sourceUrl: resource.sourceUrl, url: resource.url })
    this.resources.delete(sessionId)
    this.ids = [...this.resources.keys()]
    this.emit()
  }

  reconcileOwners(tabIds: ReadonlySet<string>): void {
    for (const [sessionId, owners] of this.owners) {
      for (const id of owners) if (!tabIds.has(id)) owners.delete(id)
      this.releaseUnowned(sessionId)
    }
  }

  private releaseUnowned(sessionId: string): void {
    if (this.owners.get(sessionId)?.size) return
    if (this.scope === 'agent') {
      const key = `topic.stream.statuses.${buildAgentSessionTopicId(sessionId)}` as const
      if (classifyTurn(cacheService.getShared(key)?.status).isTurnActive) {
        if (!this.turnSubscriptions.has(sessionId)) {
          this.turnSubscriptions.set(
            sessionId,
            cacheService.subscribe(key, () => this.releaseUnowned(sessionId))
          )
        }
        return
      }
    }
    this.close(sessionId)
  }

  syncOwners(sessionByTab: ReadonlyMap<string, string>): void {
    this.owners.clear()
    for (const [tabId, sessionId] of sessionByTab) {
      const owners = this.owners.get(sessionId) ?? new Set<string>()
      owners.add(tabId)
      this.owners.set(sessionId, owners)
    }
    for (const sessionId of [...this.resources.keys(), ...this.released.keys()]) {
      if (!this.owners.has(sessionId)) this.forget(sessionId)
    }
    if (this.ids.length !== this.resources.size) {
      this.ids = [...this.resources.keys()]
      this.emit()
    }
  }

  close(sessionId: string): void {
    this.turnSubscriptions.get(sessionId)?.()
    this.turnSubscriptions.delete(sessionId)
    this.owners.delete(sessionId)
    if (!this.forget(sessionId)) return
    this.ids = [...this.resources.keys()]
    this.emit()
  }

  private forget(sessionId: string): boolean {
    this.hiddenPages?.show(this.hiddenKey(sessionId))
    this.released.delete(sessionId)
    return this.resources.delete(sessionId)
  }

  dispose(): void {
    for (const unsubscribe of this.turnSubscriptions.values()) unsubscribe()
    this.turnSubscriptions.clear()
    this.owners.clear()
    for (const sessionId of this.resources.keys()) this.hiddenPages?.show(this.hiddenKey(sessionId))
    this.resources.clear()
    this.released.clear()
    this.ids = []
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const agentBrowserRuntimeService = new AgentBrowserRuntimeService('agent', hiddenPageUnloader)

export const topicBrowserRuntimeService = new AgentBrowserRuntimeService('topic', hiddenPageUnloader)
