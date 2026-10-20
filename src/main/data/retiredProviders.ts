const RETIRED_PROVIDER_IDS = new Set([
  'cephalon',
  'cherryai',
  'github',
  'hunyuan',
  'tencent-cloud-ti',
  'tokenflux',
  'yi'
])

/** Providers whose upstream services are gone, plus the built-in CherryAI provider this fork dropped. */
export function isRetiredProvider(providerId: string | null | undefined, presetProviderId?: string | null): boolean {
  return (
    (providerId != null && RETIRED_PROVIDER_IDS.has(providerId)) ||
    (presetProviderId != null && RETIRED_PROVIDER_IDS.has(presetProviderId))
  )
}
