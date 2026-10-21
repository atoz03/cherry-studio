#!/usr/bin/env node
// Launches a Cherry Studio build and samples the memory of its whole process tree.
//
//   node scripts/fork/measure-footprint.mjs [--seconds 120] [--interval 5] [--json out.json] -- <executable> [args...]
//   node scripts/fork/measure-footprint.mjs --scenario <file.mjs> [--cdp-port 9333] [--inspect-port 9334] [--json out.json] -- <executable> [args...]
//
// Linux reports PSS (shared pages split fairly between processes); macOS reports RSS and
// Windows the working set, both of which over-count shared memory, so only compare numbers
// taken on the same OS. Use a throwaway profile (e.g. CS_DEV_PROFILE_ROOT for unpackaged
// builds, or a copy of userData) so the run does not touch real data.
//
// --scenario drives the app instead of leaving it idle: the module's default export receives
// { page, mark, evaluateMain, sleep, log } (page = the main window over CDP via Playwright,
// evaluateMain = an expression evaluated in the main process through its inspector) and calls
// mark(label) wherever a sample should be taken. See footprint-scenario.mjs.

import { execFileSync, spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const separator = argv.indexOf('--')
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error('Usage: measure-footprint.mjs [--seconds N] [--interval N] [--json file] -- <executable> [args...]')
  }
  const options = { seconds: 120, interval: 5, json: undefined, scenario: undefined, cdpPort: 9333, inspectPort: 9334 }
  const flags = argv.slice(0, separator)
  for (let i = 0; i < flags.length; i += 2) {
    const [name, value] = [flags[i], flags[i + 1]]
    if (name === '--seconds') options.seconds = Number(value)
    else if (name === '--interval') options.interval = Number(value)
    else if (name === '--json') options.json = value
    else if (name === '--scenario') options.scenario = path.resolve(value)
    else if (name === '--cdp-port') options.cdpPort = Number(value)
    else if (name === '--inspect-port') options.inspectPort = Number(value)
    else throw new Error(`Unknown option ${name}`)
  }
  return { ...options, command: argv[separator + 1], args: argv.slice(separator + 2) }
}

/** Process table as [{ pid, ppid, kb, command }], kb = PSS on Linux, RSS elsewhere. */
function listProcesses() {
  if (process.platform === 'linux') {
    const rows = []
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
        const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').join(' ').trim()
        const pss = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${entry}/smaps_rollup`, 'utf8'))
        rows.push({ pid: Number(entry), ppid, kb: pss ? Number(pss[1]) : 0, command })
      } catch {
        // Process exited or is not readable.
      }
    }
    return rows
  }
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.WorkingSetSize)`t$($_.CommandLine)" }'
    return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [pid, ppid, bytes, ...command] = line.split('\t')
        return {
          pid: Number(pid),
          ppid: Number(ppid),
          kb: Math.round(Number(bytes) / 1024),
          command: command.join('\t')
        }
      })
  }
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [, pid, ppid, kb, command] = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? []
      return { pid: Number(pid), ppid: Number(ppid), kb: Number(kb), command: command ?? '' }
    })
}

function descendantsOf(rootPid, rows) {
  const children = new Map()
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, [])
    children.get(row.ppid).push(row)
  }
  const tree = []
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift()
    for (const child of children.get(pid) ?? []) {
      tree.push(child)
      queue.push(child.pid)
    }
  }
  const root = rows.find((row) => row.pid === rootPid)
  return root ? [root, ...tree] : tree
}

function classify(command, isRoot) {
  const type = /--type=([\w-]+)/.exec(command)?.[1]
  if (!type) return isRoot ? 'main' : 'child process'
  if (type === 'utility') return `utility:${/--utility-sub-type=([\w.-]+)/.exec(command)?.[1] ?? 'unknown'}`
  return type
}

function sample(appPid) {
  const rows = descendantsOf(appPid, listProcesses())
  const byType = {}
  for (const row of rows) {
    const type = classify(row.command, row.pid === appPid)
    byType[type] ??= { count: 0, mb: 0 }
    byType[type].count += 1
    byType[type].mb += row.kb / 1024
  }
  const totalMb = Object.values(byType).reduce((sum, entry) => sum + entry.mb, 0)
  return { processes: rows.length, totalMb, byType }
}

const options = parseArgs(process.argv.slice(2))
const appArgs = options.scenario
  ? [...options.args, `--remote-debugging-port=${options.cdpPort}`, `--inspect=${options.inspectPort}`]
  : options.args
const child = spawn(options.command, appArgs, { stdio: 'ignore', env: process.env })
const samples = []
const startedAt = Date.now()
const elapsedSeconds = () => Math.round((Date.now() - startedAt) / 1000)

let timer
if (options.scenario) {
  runScenario().then(
    () => finish(),
    (error) => {
      console.error('Scenario failed:', error)
      finish(1)
    }
  )
} else {
  timer = setInterval(() => {
    const seconds = elapsedSeconds()
    const snapshot = sample(child.pid)
    samples.push({ seconds, ...snapshot })
    console.log(`${String(seconds).padStart(4)}s  ${snapshot.processes} processes  ${snapshot.totalMb.toFixed(0)} MB`)
    if (seconds >= options.seconds) finish()
  }, options.interval * 1000)
}

child.on('exit', (code) => {
  if (options.scenario || samples.length === 0 || samples.at(-1).seconds < options.seconds) {
    console.error(`App exited early with code ${code}`)
    finish(1)
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => finish(1))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForJson(url, accept) {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const list = await (await fetch(url)).json()
      const found = accept(list)
      if (found) return found
    } catch {
      // Not listening yet.
    }
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

/** Evaluates an expression in the main process (Node inspector, with `require` available). */
async function connectMainInspector() {
  const target = await waitForJson(`http://127.0.0.1:${options.inspectPort}/json/list`, (list) => list[0])
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  const evaluateMain = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, ({ result, error }) => {
        if (error || result.exceptionDetails) reject(new Error(JSON.stringify(error ?? result.exceptionDetails)))
        else resolve(result.result.value)
      })
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true }
        })
      )
    })
  return { evaluateMain, close: () => socket.close() }
}

async function runScenario() {
  const { chromium } = await import('@playwright/test')
  await waitForJson(`http://127.0.0.1:${options.cdpPort}/json/list`, (list) =>
    list.some((target) => target.url.includes('/windows/main/'))
  )
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.cdpPort}`)
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/windows/main/'))
  if (!page) throw new Error('Main window page not found')
  const inspector = await connectMainInspector()
  const mark = (label) => {
    const snapshot = sample(child.pid)
    samples.push({ label, seconds: elapsedSeconds(), ...snapshot })
    console.log(`${String(elapsedSeconds()).padStart(4)}s  ${label.padEnd(24)} ${snapshot.totalMb.toFixed(0)} MB`)
  }
  const scenario = (await import(pathToFileURL(options.scenario).href)).default
  try {
    await scenario({ page, mark, evaluateMain: inspector.evaluateMain, sleep, log: console.log })
  } finally {
    inspector.close()
    await browser.close().catch(() => {})
  }
}

function printLastSample(last) {
  console.log(`\nAfter ${last.seconds}s (${process.platform === 'linux' ? 'PSS' : 'RSS'}):`)
  for (const [type, entry] of Object.entries(last.byType).sort((a, b) => b[1].mb - a[1].mb)) {
    console.log(`  ${type.padEnd(32)} ${String(entry.count).padStart(3)} × ${entry.mb.toFixed(1).padStart(8)} MB`)
  }
  console.log(
    `  ${'total'.padEnd(32)} ${String(last.processes).padStart(3)}   ${last.totalMb.toFixed(1).padStart(8)} MB`
  )
}

/** One column per mark: "count × MB" for each process type, then the total. */
function printMarks() {
  const types = [...new Set(samples.flatMap((entry) => Object.keys(entry.byType)))].sort()
  const cell = (entry, type) => {
    const value = entry.byType[type]
    return value ? `${value.count} × ${value.mb.toFixed(0)}` : '-'
  }
  const rows = [
    ['', ...samples.map((entry) => entry.label)],
    ...types.map((type) => [type, ...samples.map((entry) => cell(entry, type))]),
    ['total MB', ...samples.map((entry) => entry.totalMb.toFixed(0))]
  ]
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  console.log(`\n${process.platform === 'linux' ? 'PSS' : 'RSS'} by process type (count × MB):`)
  for (const row of rows) console.log(row.map((value, column) => value.padStart(widths[column])).join('  '))
}

let finishing = false
function finish(exitCode = 0) {
  if (finishing) return
  finishing = true
  clearInterval(timer)
  if (options.scenario) {
    if (samples.length > 0) printMarks()
  } else if (samples.length > 0) {
    printLastSample(samples.at(-1))
  }
  if (options.json) writeFileSync(options.json, JSON.stringify({ command: options.command, samples }, null, 2))
  for (const row of descendantsOf(child.pid, listProcesses()).reverse()) {
    try {
      process.kill(row.pid)
    } catch {
      // Already gone.
    }
  }
  process.exit(exitCode)
}
