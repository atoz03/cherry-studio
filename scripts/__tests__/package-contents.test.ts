import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { getNativeModuleFilters } from '../packaging/before-pack'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
  files: string[]
  extraResources: Array<{ from: string; to: string; filter?: string[] }>
}
const fileStat = statSync(path.join(projectRoot, 'package.json'))

function includesFile(filename: string, patterns = config.files, root = projectRoot): boolean {
  return new FileMatcher(root, root, (value: string) => value, patterns).createFilter()(
    path.join(root, filename),
    fileStat
  )
}

describe('packaged dependency contents', () => {
  it('keeps the Computer Use SDK while its native helpers are installed outside ASAR', () => {
    expect(includesFile('node_modules/@cherrystudio/computer-use/dist/index.cjs')).toBe(true)
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      for (const platform of ['darwin', 'linux', 'win32']) {
        for (const arch of ['arm64', 'x64']) {
          expect(includesFile(`${modules}/@cherrystudio/computer-use-${platform}-${arch}/runtime/helper`)).toBe(false)
        }
      }
    }
  })

  it('keeps the SDK but excludes every native Claude payload, including nested packages', () => {
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      expect(includesFile(`${modules}/@anthropic-ai/claude-agent-sdk/sdk.mjs`)).toBe(true)
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
        'linux-arm64-musl',
        'linux-x64-musl',
        'win32-arm64',
        'win32-x64'
      ]) {
        for (const file of ['claude', 'claude.exe', 'package.json']) {
          expect(includesFile(`${modules}/@anthropic-ai/claude-agent-sdk-${target}/${file}`)).toBe(false)
        }
      }
    }
  })
  it.each([
    ['darwin', 'arm64', 'darwin-arm64'],
    ['darwin', 'x64', 'darwin-x64'],
    ['linux', 'arm64', 'linux-arm64-gnu'],
    ['linux', 'x64', 'linux-x64-gnu'],
    ['win32', 'arm64', 'win32-arm64-msvc'],
    ['win32', 'x64', 'win32-x64-msvc']
  ])('keeps only %s %s native payloads, including nested dependencies', (platform, arch, nativeBindingTarget) => {
    const patterns = [...config.files, ...getNativeModuleFilters(platform, arch)]
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      for (const targetPlatform of ['darwin', 'linux', 'win32']) {
        for (const targetArch of ['arm64', 'x64']) {
          const target = `${targetPlatform}-${targetArch}`
          const keep = targetPlatform === platform && targetArch === arch
          for (const file of [
            `@koromix/koffi-${target}/koffi.node`,
            `node-pty/prebuilds/${target}/pty.node`,
            `selection-hook/prebuilds/${target}/selection.node`
          ]) {
            expect(includesFile(`${modules}/${file}`, patterns), file).toBe(keep)
          }
        }
      }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'darwin-universal',
        'linux-arm64-gnu',
        'linux-x64-gnu',
        'linux-x64-musl',
        'win32-arm64-msvc',
        'win32-x64-msvc'
      ]) {
        const file = `${modules}/@mariozechner/clipboard-${target}/clipboard.node`
        expect(includesFile(file, patterns), file).toBe(target === nativeBindingTarget)
      }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64-gnu',
        'linux-x64-gnu',
        'win32-arm64-msvc',
        'win32-ia32-msvc',
        'win32-x64-msvc'
      ]) {
        const file = `${modules}/node-addon-require-builtin-${target}/package.json`
        expect(includesFile(file, patterns), file).toBe(target === nativeBindingTarget)
      }
    }
  })

  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'excludes SQLite build inputs and cached binaries under %s while preserving its runtime',
    (modules) => {
      const root = `${modules}/better-sqlite3`
      for (const file of [
        'deps/sqlite3/sqlite3.c',
        'build/Release/obj/gen/sqlite3/sqlite3.c',
        'bin/darwin-x64-149/better-sqlite3.node',
        'src/better_sqlite3.cpp'
      ]) {
        expect(includesFile(`${root}/${file}`), file).toBe(false)
      }
      for (const file of ['package.json', 'lib/database.js', 'build/Release/better_sqlite3.node']) {
        expect(includesFile(`${root}/${file}`), file).toBe(true)
      }
    }
  )

  it('excludes dependency documentation images without removing runtime assets or source JS', () => {
    for (const file of ['node_modules/selection-hook/docs/images/selection-hook.gif']) {
      expect(includesFile(file), file).toBe(false)
    }
    for (const file of [
      'node_modules/koffi/src/koffi/index.cjs',
      'node_modules/pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap',
      'resources/builtin-agents/icon.png'
    ]) {
      expect(includesFile(file), file).toBe(true)
    }
  })

  it('keeps the pdf-parse ESM entries and the pdf.js files they load while dropping unused builds', () => {
    for (const file of [
      'node_modules/pdf-parse/package.json',
      'node_modules/pdf-parse/dist/pdf-parse/esm/index.js',
      'node_modules/pdf-parse/dist/pdf-parse/esm/PDFParse.js',
      'node_modules/pdf-parse/dist/worker/esm/index.js',
      'node_modules/pdfjs-dist/package.json',
      'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      'node_modules/pdfjs-dist/standard_fonts/FoxitDingbats.pfb',
      'node_modules/@napi-rs/canvas/index.js'
    ]) {
      expect(includesFile(file), file).toBe(true)
    }
    for (const file of [
      'node_modules/pdf-parse/bin/cli.mjs',
      'node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs',
      'node_modules/pdf-parse/dist/pdf-parse/web/pdf-parse.es.js',
      'node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs',
      'node_modules/pdf-parse/dist/worker/cjs/index.cjs',
      'node_modules/pdf-parse/dist/worker/pdf.worker.mjs',
      'node_modules/pdfjs-dist/build/pdf.mjs',
      'node_modules/pdfjs-dist/web/pdf_viewer.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      'node_modules/pdfjs-dist/legacy/build/pdf.sandbox.mjs',
      'node_modules/pdfjs-dist/wasm/openjpeg.wasm',
      'node_modules/canvas/index.js',
      'node_modules/@mapbox/node-pre-gyp/lib/node-pre-gyp.js',
      'node_modules/nan/include_dirs.js'
    ]) {
      expect(includesFile(file), file).toBe(false)
    }
  })

  it('ships each journaled migration once, outside ASAR, without drizzle-kit snapshots', () => {
    const from = 'migrations/sqlite-drizzle'
    const resource = config.extraResources.find((entry) => entry.from === from)
    const root = path.join(projectRoot, from)
    const journal = JSON.parse(readFileSync(path.join(root, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>
    }
    const shipped = (file: string) => includesFile(file, resource?.filter ?? [], root)

    expect(includesFile(`${from}/meta/_journal.json`)).toBe(false)
    expect(shipped('meta/_journal.json')).toBe(true)
    expect(journal.entries.length).toBeGreaterThan(0)
    for (const { tag } of journal.entries) {
      expect(shipped(`${tag}.sql`), tag).toBe(true)
      expect(shipped(`meta/${tag.slice(0, 4)}_snapshot.json`), tag).toBe(false)
    }
  })
})
