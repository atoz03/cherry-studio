import { application } from '@application'
import { t } from '@main/i18n'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { getShellEnv } from '@main/utils/shellEnv'

import { PiRpcClient } from './piRpcClient'

/** The user's `pi` and the login-shell environment it runs in, as it would from their terminal. */
export async function resolvePiLaunch(): Promise<{ command: string; env: Record<string, string> }> {
  const env = await getShellEnv()
  const command = await findExecutableInEnv('pi', { env })
  if (!command) throw new Error(t('agent.session.pi.cli_not_found'))
  return { command, env }
}

/** A model entry of pi's `get_available_models` (docs/rpc-commands.md, "Model object"). */
export interface PiCliModel {
  id: string
  name?: string
  provider: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
}

/** The models the user configured in pi, read from a short-lived RPC process. */
export async function listPiCliModels(): Promise<PiCliModel[]> {
  const { command, env } = await resolvePiLaunch()
  const client = new PiRpcClient({
    command,
    args: ['--mode', 'rpc', '--no-session', '--offline'],
    cwd: application.getPath('sys.home'),
    env,
    onRecord: () => undefined,
    onExit: () => undefined
  })
  try {
    return (await client.request<{ models: PiCliModel[] }>({ type: 'get_available_models' })).models
  } finally {
    await client.close()
  }
}
