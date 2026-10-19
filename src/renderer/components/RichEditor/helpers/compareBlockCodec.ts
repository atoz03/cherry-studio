/**
 * On-disk format of the notes compare block, kept byte-compatible with the v1 fork:
 *
 * - each block is a marker line in the body: `--- <!-- cs-compare-block:cb_xxx collapsed=1 -->`
 * - all block contents live in one footer tag at the end of the file:
 *   `<cs-compare-meta data-v="1" data-json="<base64 of {"v":1,"blocks":{"cb_xxx":{"content":"…"}}}>"></cs-compare-meta>`
 */

/**
 * Transaction meta for compare-block edits made from the node view (toggle, nested editor). Those
 * happen while the main editor is unfocused, so `useRichEditor` must not drop them as programmatic.
 */
export const COMPARE_BLOCK_EDIT_META = 'compareBlockEdit'

export interface CompareBlockMeta {
  v: 1
  blocks: Record<string, { content: string }>
}

export interface CompareBlockMarker {
  id: string
  collapsed: boolean
}

const MARKER_LINE_REGEX =
  /^---[^\S\n]*<!--[^\S\n]*cs-compare-block:([a-zA-Z0-9_-]+)(?:[^\S\n]+collapsed=(0|1))?[^\S\n]*-->[^\S\n]*(?:\n|$)/
const MARKER_START_REGEX = /^---[^\S\n]*<!--[^\S\n]*cs-compare-block:/m

const META_TAG_REGEX = /^<cs-compare-meta\b[^>]*\bdata-json="([^"]+)"[^>]*>(?:\s*<\/cs-compare-meta>)?[^\S\n]*(?:\n|$)/i
const META_START_REGEX = /^<cs-compare-meta\b/im

/** Index of the next marker line in `src`, or -1. */
export function findCompareMarkerStart(src: string): number {
  return src.search(MARKER_START_REGEX)
}

/** Parse a marker line at the very start of `src`; `collapsed` defaults to true like v1. */
export function matchCompareMarker(src: string): (CompareBlockMarker & { raw: string }) | null {
  const match = MARKER_LINE_REGEX.exec(src)
  if (!match) return null
  return { raw: match[0], id: match[1], collapsed: match[2] ? match[2] === '1' : true }
}

export function buildCompareMarkerLine({ id, collapsed }: CompareBlockMarker): string {
  return `--- <!-- cs-compare-block:${id} collapsed=${collapsed ? '1' : '0'} -->`
}

/** Index of the next metadata footer tag in `src`, or -1. */
export function findCompareMetaStart(src: string): number {
  return src.search(META_START_REGEX)
}

/** Parse a metadata footer tag at the very start of `src`. Undecodable tags return null. */
export function matchCompareMeta(src: string): { raw: string; meta: CompareBlockMeta } | null {
  const match = META_TAG_REGEX.exec(src)
  if (!match) return null
  const decoded = decodeBase64Utf8(match[1])
  if (decoded === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decoded)
  } catch {
    return null
  }
  return isCompareBlockMeta(parsed) ? { raw: match[0], meta: parsed } : null
}

export function buildCompareMetaTag(meta: CompareBlockMeta): string {
  return `<cs-compare-meta data-v="${meta.v}" data-json="${encodeBase64Utf8(JSON.stringify(meta))}"></cs-compare-meta>`
}

/** Append the footer exactly as v1 did; a body without blocks is returned untouched. */
export function appendCompareMeta(markdown: string, blocks: CompareBlockMeta['blocks']): string {
  if (Object.keys(blocks).length === 0) return markdown
  return `${markdown.trimEnd()}\n\n${buildCompareMetaTag({ v: 1, blocks })}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCompareBlockMeta(value: unknown): value is CompareBlockMeta {
  if (!isRecord(value) || value.v !== 1 || !isRecord(value.blocks)) return false
  return Object.entries(value.blocks).every(
    ([id, block]) => id !== '' && isRecord(block) && typeof block.content === 'string'
  )
}

function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64Utf8(input: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(input), (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
