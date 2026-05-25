const BUILTIN_AGENT_IDS = new Set<string>()

export function isBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENT_IDS.has(id)
}
