#!/usr/bin/env node
// Launches a Cherry Studio build and samples the memory of its whole process tree.
//
//   node scripts/fork/measure-footprint.mjs [--seconds 120] [--interval 5] [--json out.json] -- <executable> [args...]
//
// Linux reports PSS (shared pages split fairly between processes); macOS reports RSS and
// Windows the working set, both of which over-count shared memory, so only compare numbers
// taken on the same OS. Use a throwaway profile (e.g. CS_DEV_PROFILE_ROOT for unpackaged
// builds, or a copy of userData) so the run does not touch real data.

import { execFileSync, spawn } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

function parseArgs(argv) {
  const separator = argv.indexOf('--')
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error('Usage: measure-footprint.mjs [--seconds N] [--interval N] [--json file] -- <executable> [args...]')
  }
  const options = { seconds: 120, interval: 5, json: undefined }
  const flags = argv.slice(0, separator)
  for (let i = 0; i < flags.length; i += 2) {
    const [name, value] = [flags[i], flags[i + 1]]
    if (name === '--seconds') options.seconds = Number(value)
    else if (name === '--interval') options.interval = Number(value)
    else if (name === '--json') options.json = value
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
const child = spawn(options.command, options.args, { stdio: 'ignore', env: process.env })
const samples = []
const startedAt = Date.now()

const timer = setInterval(() => {
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  const snapshot = sample(child.pid)
  samples.push({ seconds, ...snapshot })
  console.log(`${String(seconds).padStart(4)}s  ${snapshot.processes} processes  ${snapshot.totalMb.toFixed(0)} MB`)
  if (seconds >= options.seconds) finish()
}, options.interval * 1000)

child.on('exit', (code) => {
  if (samples.length === 0 || samples.at(-1).seconds < options.seconds) {
    console.error(`App exited early with code ${code}`)
    finish(1)
  }
})

function finish(exitCode = 0) {
  clearInterval(timer)
  const last = samples.at(-1)
  if (last) {
    console.log(`\nAfter ${last.seconds}s (${process.platform === 'linux' ? 'PSS' : 'RSS'}):`)
    for (const [type, entry] of Object.entries(last.byType).sort((a, b) => b[1].mb - a[1].mb)) {
      console.log(`  ${type.padEnd(32)} ${String(entry.count).padStart(3)} × ${entry.mb.toFixed(1).padStart(8)} MB`)
    }
    console.log(
      `  ${'total'.padEnd(32)} ${String(last.processes).padStart(3)}   ${last.totalMb.toFixed(1).padStart(8)} MB`
    )
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
