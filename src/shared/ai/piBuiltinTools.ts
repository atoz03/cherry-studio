/** pi's own built-in tools that an agent can switch off (`pi --exclude-tools`). Names are pi's. */
export const PI_BUILTIN_TOOLS = [
  { name: 'read', category: 'file' },
  { name: 'bash', category: 'shell' },
  { name: 'edit', category: 'file' },
  { name: 'write', category: 'file' }
] as const

export const PI_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set(PI_BUILTIN_TOOLS.map((tool) => tool.name))

/** The former bundled runtime's MCP wrapper tool; its saved history still carries it. */
export const PI_TOOL_CALL_TOOL_NAME = 'tool_call'
