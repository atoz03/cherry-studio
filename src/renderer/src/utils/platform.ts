export function isWebRuntime(): boolean {
  return import.meta.env.VITE_APP_TARGET === 'web'
}

export function getWebApiBaseUrl(): string {
  const configuredBase = import.meta.env.VITE_WEB_API_BASE_URL
  const prefix = import.meta.env.VITE_WEB_API_PREFIX || '/api'

  let base = configuredBase || window.location.origin
  if (!configuredBase && import.meta.env.DEV) {
    base = `${window.location.protocol}//${window.location.hostname}:3001`
  }

  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  return `${normalizedBase}${normalizedPrefix}`
}
