import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { PiRpcClient, type PiRpcRecord } from './piRpcClient'

// Speaks pi's RPC framing: one JSON record per LF-terminated line.
const FAKE_PI = `
let buffer = ''
const send = (record) => process.stdout.write(JSON.stringify(record) + '\\n')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    if (command.type === 'echo') {
      send({ type: 'message_update', text: 'line\\u2028separator' })
      send({ type: 'response', id: command.id, command: 'echo', success: true, data: { text: command.text } })
    } else if (command.type === 'fail') {
      send({ type: 'response', id: command.id, command: 'fail', success: false, error: 'nope' })
    } else if (command.type === 'die') {
      process.stderr.write('model provider exploded')
      process.exit(3)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
`

const directory = mkdtempSync(path.join(tmpdir(), 'cherry-fake-pi-'))
const script = path.join(directory, 'pi.js')
writeFileSync(script, FAKE_PI)

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function startPi() {
  const records: PiRpcRecord[] = []
  const onExit = vi.fn()
  const client = new PiRpcClient({
    command: process.execPath,
    args: [script],
    cwd: directory,
    env: process.env,
    onRecord: (record) => records.push(record),
    onExit
  })
  return { client, records, onExit }
}

describe('PiRpcClient', () => {
  it('answers each request with its own response and passes events through intact', async () => {
    const { client, records } = startPi()
    try {
      const [first, second] = await Promise.all([
        client.request<{ text: string }>({ type: 'echo', text: 'one' }),
        client.request<{ text: string }>({ type: 'echo', text: 'two' })
      ])
      expect([first.text, second.text]).toEqual(['one', 'two'])
      // U+2028 is legal inside a JSON string and must not split the record.
      expect(records).toEqual([
        { type: 'message_update', text: 'line\u2028separator' },
        { type: 'message_update', text: 'line\u2028separator' }
      ])
    } finally {
      await client.close()
    }
  })

  it("rejects a failed command with pi's error", async () => {
    const { client } = startPi()
    try {
      await expect(client.request({ type: 'fail' })).rejects.toThrow('nope')
    } finally {
      await client.close()
    }
  })

  it('rejects pending requests with the stderr tail when pi dies', async () => {
    const { client, onExit } = startPi()
    await expect(client.request({ type: 'die' })).rejects.toThrow('model provider exploded')
    expect(client.running).toBe(false)
    expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('exited with 3') }))
    await expect(client.request({ type: 'echo', text: 'late' })).rejects.toThrow('pi is not running')
  })

  it('reports a clean exit when closed', async () => {
    const { client, onExit } = startPi()
    await client.close()
    expect(client.running).toBe(false)
    expect(onExit).toHaveBeenCalledWith(undefined)
  })
})
