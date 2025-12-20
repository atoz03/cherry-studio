export function isWebRuntime(): boolean {
  return import.meta.env.VITE_APP_TARGET === 'web'
}

export function getWebApiBaseUrl(): string {
  const base = import.meta.env.VITE_WEB_API_BASE_URL || window.location.origin
  const prefix = import.meta.env.VITE_WEB_API_PREFIX || '/api'
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  return `${normalizedBase}${normalizedPrefix}`
}
