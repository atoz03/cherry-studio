import * as z from 'zod'

import type { ApiGatewayStatusResult, ApiGatewayStopResult } from '@shared/types/apiGateway'

import { defineRoute } from '../define'

/**
 * Start/stop/restart retain their legacy status results.
 * Running state and config remain on their data-layer channels.
 */
const statusResultSchema: z.ZodType<ApiGatewayStatusResult> = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

const stopResultSchema: z.ZodType<ApiGatewayStopResult> = z.union([
  z.object({ success: z.literal(true), outcome: z.literal('stopped') }),
  z.object({ success: z.literal(false), error: z.string() })
])

export const apiGatewayRequestSchemas = {
  'api_gateway.start': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.stop': defineRoute({ input: z.void(), output: stopResultSchema }),
  'api_gateway.restart': defineRoute({ input: z.void(), output: statusResultSchema })
}
