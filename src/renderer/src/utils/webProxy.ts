type FetchInput = RequestInfo | URL

function normalizeTarget(input: FetchInput): string {
  if (input instanceof Request) {
    return input.url
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input
}

export function createWebProxyFetch(proxyBaseUrl: string): typeof fetch {
  return async (input: FetchInput, init?: RequestInit) => {
    const targetUrl = normalizeTarget(input)
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    headers.set('x-cherry-proxy-url', targetUrl)

    const proxyUrl = `${proxyBaseUrl}/proxy`
    const method = init?.method || (input instanceof Request ? input.method : 'GET')
    const body = init?.body || (input instanceof Request ? input.body : undefined)

    const response = await fetch(proxyUrl, {
      ...init,
      method,
      headers,
      body
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = await response.clone().text()
      } catch {
        detail = ''
      }
      throw new Error(`代理请求失败: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`)
    }

    return response
  }
}
