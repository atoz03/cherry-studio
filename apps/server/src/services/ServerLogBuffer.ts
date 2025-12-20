import type { MCPServerLogEntry } from '@shared/config/types'

export class ServerLogBuffer {
  private limit: number
  private buffer: Map<string, MCPServerLogEntry[]> = new Map()

  constructor(limit: number) {
    this.limit = limit
  }

  append(key: string, entry: MCPServerLogEntry) {
    const list = this.buffer.get(key) || []
    list.push(entry)
    if (list.length > this.limit) {
      list.splice(0, list.length - this.limit)
    }
    this.buffer.set(key, list)
  }

  get(key: string): MCPServerLogEntry[] {
    return this.buffer.get(key) || []
  }
}
