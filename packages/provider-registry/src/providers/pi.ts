import { defineProvider } from './types'

/**
 * Agent-only provider for the user's local pi CLI (`authMethods: ['external-cli']`): pi keeps its
 * own credentials and model configuration. The model list is read from pi itself
 * (`src/main/ai/provider/listModels.ts`); runtime behavior lives in `src/main/ai/runtime/pi/`.
 */
export default defineProvider({
  id: 'pi',
  name: 'Pi',
  availableInEditions: ['global', 'cn'],
  authMethods: ['external-cli'],
  endpointConfigs: {},
  metadata: {
    website: {
      official: 'https://pi.dev'
    }
  }
})
