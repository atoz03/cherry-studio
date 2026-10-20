/**
 * Runtime-neutral local API Gateway route resolution, shared by drivers whose
 * wire protocol or model mix requires the gateway. Agent traffic always uses
 * the internal loopback listener, never the user-facing gateway.
 */
import { application } from '@application'

/**
 * Gateway identity for connection signatures: a restarted internal listener rebuilds the connection.
 * Read-only by contract — this must never start the listener.
 */
export function gatewayCredentialsFingerprint(): string {
  return `internal-gateway:${application.get('ApiGatewayService').getInternalGatewayOrigin() ?? 'stopped'}`
}

/** Internal gateway route for an Agent session; starts the loopback listener on first use. */
export async function resolveApiGatewayRuntime(sessionId: string): Promise<{
  baseUrl: string
  apiKey: string
  usageHeaders: Record<string, string>
}> {
  const apiGatewayService = application.get('ApiGatewayService')
  const { baseUrl, apiKey } = await apiGatewayService.ensureInternalGateway()
  return { baseUrl, apiKey, usageHeaders: apiGatewayService.getAgentSessionUsageHeaders(sessionId) }
}
