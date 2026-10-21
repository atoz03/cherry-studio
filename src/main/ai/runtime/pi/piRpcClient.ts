import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'

const logger = loggerService.withContext('PiRpcClient')

/** One stdout record of `pi --mode rpc` other than a command response: a session event or extension UI request. */
export type PiRpcRecord = { type: string } & Record<string, unknown>

export interface PiRpcClientOptions {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  onRecord(record: PiRpcRecord): void
  /** Fires once when the process is gone; `error` is set unless it exited cleanly. */
  onExit(error: Error | undefined): void
}

interface PendingRequest {
  command: string
  resolve(data: unknown): void
  reject(error: Error): void
}

const STDERR_TAIL_BYTES = 4000

/**
 * JSONL client for `pi --mode rpc` (see pi's docs/rpc.md). Records are split on LF only: Node's
 * `readline` also splits on U+2028/U+2029, which are legal inside JSON strings.
 */
export class PiRpcClient {
  private readonly child: ChildProcess
  private readonly pending = new Map<string, PendingRequest>()
  private readonly decoder = new StringDecoder('utf8')
  private nextId = 0
  private buffer = ''
  private stderrTail = ''
  private exited = false

  constructor(private readonly options: PiRpcClientOptions) {
    this.child = crossPlatformSpawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      // Own process group, so terminateProcessTree also reaches pi's bash children.
      detached: !isWin,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout?.on('data', (chunk: Buffer) => this.handleData(this.decoder.write(chunk)))
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES)
    })
    // Writes after pi exits fail with EPIPE; the exit itself is reported through `close`.
    this.child.stdin?.on('error', () => undefined)
    this.child.once('error', (error) => this.handleExit(error))
    this.child.once('close', (code, signal) =>
      this.handleExit(
        code === 0 ? undefined : new Error(`pi exited with ${code ?? signal}: ${this.stderrTail.trim() || 'no output'}`)
      )
    )
  }

  get running(): boolean {
    return !this.exited
  }

  request<T = unknown>(command: { type: string } & Record<string, unknown>): Promise<T> {
    if (this.exited) return Promise.reject(new Error('pi is not running'))
    const id = `cherry-${++this.nextId}`
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { command: command.type, resolve, reject })
      this.write({ ...command, id })
    })
  }

  /** Write a record that has no command response, such as `extension_ui_response`. */
  notify(record: { type: string } & Record<string, unknown>): void {
    this.write(record)
  }

  /** Close stdin for pi's orderly shutdown, escalating to signals if it lingers. */
  async close(timeoutMs = 5000): Promise<void> {
    if (this.exited) return
    this.child.stdin?.end()
    if (await waitForProcessExit(this.child, timeoutMs)) return
    await terminateProcessTree(this.child, false, 'pi')
    if (await waitForProcessExit(this.child, 2000)) return
    await terminateProcessTree(this.child, true, 'pi')
  }

  private write(record: Record<string, unknown>): void {
    if (this.exited) return
    this.child.stdin?.write(`${JSON.stringify(record)}\n`)
  }

  private handleData(text: string): void {
    this.buffer += text
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let record: PiRpcRecord
    try {
      record = JSON.parse(line) as PiRpcRecord
    } catch {
      logger.warn('Ignoring a non-JSON line from pi', { length: line.length })
      return
    }
    if (record.type !== 'response') {
      this.options.onRecord(record)
      return
    }
    const pending = typeof record.id === 'string' ? this.pending.get(record.id) : undefined
    if (!pending) {
      if (record.success === false)
        logger.warn('pi rejected a command', { command: record.command, error: record.error })
      return
    }
    this.pending.delete(record.id as string)
    if (record.success) pending.resolve(record.data)
    else pending.reject(new Error(typeof record.error === 'string' ? record.error : `pi ${pending.command} failed`))
  }

  private handleExit(error: Error | undefined): void {
    if (this.exited) return
    this.exited = true
    const failure = error ?? new Error('pi exited')
    for (const pending of this.pending.values()) pending.reject(failure)
    this.pending.clear()
    this.options.onExit(error)
  }
}
