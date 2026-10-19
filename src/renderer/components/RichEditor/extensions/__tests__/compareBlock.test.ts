import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../../createExtensions'

/**
 * Reference encoder/decoder copied from the v1 fork (tag `v1-final`,
 * `src/renderer/src/components/RichEditor/helpers/compareBlockCodec.ts` and the turndown
 * `compareBlock` rule) so the samples are exactly what v1 wrote to disk.
 */
const v1 = {
  markerLine: (id: string, collapsed: boolean) =>
    `--- <!-- cs-compare-block:${id} collapsed=${collapsed ? '1' : '0'} -->`,
  metaTag: (meta: { v: 1; blocks: Record<string, { content: string }> }) =>
    `<cs-compare-meta data-v="${meta.v}" data-json="${Buffer.from(JSON.stringify(meta), 'utf-8').toString('base64')}"></cs-compare-meta>`,
  appendMeta: (markdown: string, meta: { v: 1; blocks: Record<string, { content: string }> }) =>
    `${markdown.trimEnd()}\n\n${v1.metaTag(meta)}\n`,
  extractMeta: (markdown: string) => {
    const matches = [
      ...markdown.matchAll(/<cs-compare-meta[^>]*data-json="([^"]+)"[^>]*>(?:\s*<\/cs-compare-meta>\s*)?/gi)
    ]
    const last = matches.at(-1)
    return last ? JSON.parse(Buffer.from(last[1], 'base64').toString('utf-8')) : null
  }
}

const FIRST_CONTENT = '对照内容 ✅\n\n- 列表项\n- **粗体**'
const SECOND_CONTENT = 'AI 草稿：\n\n```ts\nconst a = 1\n```'

const v1Body = [
  '# 标题',
  '正文第一段',
  v1.markerLine('cb_first01', true),
  '正文第二段',
  v1.markerLine('cb_second2', false),
  '结尾段落'
].join('\n\n')

const v1Sample = v1.appendMeta(v1Body, {
  v: 1,
  blocks: { cb_first01: { content: FIRST_CONTENT }, cb_second2: { content: SECOND_CONTENT } }
})

let editor: Editor | undefined

const load = (markdown: string): Editor => {
  editor?.destroy()
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions(),
    content: markdown,
    contentType: 'markdown'
  })
  return editor
}

const compareBlocks = (instance: Editor): JSONContent[] =>
  (instance.getJSON().content ?? []).filter((node) => node.type === 'compareBlock')

const findCompareBlockPos = (instance: Editor, id: string): number => {
  let found = -1
  instance.state.doc.descendants((node, pos) => {
    if (node.type.name === 'compareBlock' && node.attrs.id === id) found = pos
    return found === -1
  })
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('compare block markdown round-trip', () => {
  it('reads v1 notes into compare blocks carrying their stored content', () => {
    const blocks = compareBlocks(load(v1Sample))

    expect(blocks.map((block) => block.attrs)).toEqual([
      { id: 'cb_first01', collapsed: true, content: FIRST_CONTENT },
      { id: 'cb_second2', collapsed: false, content: SECOND_CONTENT }
    ])
    expect(editor!.getText()).not.toContain('cs-compare')
  })

  it('writes an untouched v1 note back byte-for-byte', () => {
    expect(load(v1Sample).getMarkdown()).toBe(v1Sample)
  })

  it('keeps markers and metadata when the surrounding text is edited', () => {
    const instance = load(v1Sample)
    instance.commands.insertContentAt(instance.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'text', text: '新增' }]
    })

    const saved = instance.getMarkdown()
    expect(saved).toContain(`${v1.markerLine('cb_first01', true)}\n\n正文第二段`)
    expect(saved).toContain(v1.markerLine('cb_second2', false))
    expect(saved.endsWith('</cs-compare-meta>\n')).toBe(true)
    expect(v1.extractMeta(saved)).toEqual({
      v: 1,
      blocks: { cb_first01: { content: FIRST_CONTENT }, cb_second2: { content: SECOND_CONTENT } }
    })
  })

  it('persists edited block content and collapse state in the v1 format', () => {
    const instance = load(v1Sample)
    const pos = findCompareBlockPos(instance, 'cb_first01')
    instance.view.dispatch(
      instance.state.tr.setNodeAttribute(pos, 'content', '新的对照').setNodeAttribute(pos, 'collapsed', false)
    )

    const saved = instance.getMarkdown()
    expect(saved).toContain(v1.markerLine('cb_first01', false))
    expect(v1.extractMeta(saved)?.blocks.cb_first01).toEqual({ content: '新的对照' })

    expect(compareBlocks(load(saved))[0]?.attrs).toEqual({ id: 'cb_first01', collapsed: false, content: '新的对照' })
  })

  it('drops metadata of deleted blocks and the whole footer once no block is left', () => {
    const instance = load(v1Sample)
    const firstPos = findCompareBlockPos(instance, 'cb_first01')
    instance.view.dispatch(instance.state.tr.delete(firstPos, firstPos + 1))
    expect(Object.keys(v1.extractMeta(instance.getMarkdown())?.blocks ?? {})).toEqual(['cb_second2'])

    const secondPos = findCompareBlockPos(instance, 'cb_second2')
    instance.view.dispatch(instance.state.tr.delete(secondPos, secondPos + 1))
    const saved = instance.getMarkdown()
    expect(saved).not.toContain('cs-compare')
    expect(saved).toBe('# 标题\n\n正文第一段\n\n正文第二段\n\n结尾段落')
  })

  it('leaves notes without compare blocks unchanged', () => {
    expect(load('# Title\n\nplain text\n\n---\n\nafter rule').getMarkdown()).toBe(
      '# Title\n\nplain text\n\n---\n\nafter rule'
    )
  })

  it('recognises a marker line written directly under a paragraph', () => {
    const markdown = v1.appendMeta(`para\n${v1.markerLine('cb_tight01', true)}\nnext`, {
      v: 1,
      blocks: { cb_tight01: { content: 'x' } }
    })

    const nodes = load(markdown).getJSON().content ?? []
    expect(nodes.map((node) => node.type)).toEqual(['paragraph', 'compareBlock', 'paragraph'])
    expect(nodes[1]?.attrs?.content).toBe('x')
  })

  it('gives a marker without metadata empty content and defaults it to collapsed', () => {
    const blocks = compareBlocks(load('text\n\n--- <!-- cs-compare-block:cb_orphan -->'))
    expect(blocks.map((block) => block.attrs)).toEqual([{ id: 'cb_orphan', collapsed: true, content: '' }])
  })
})

describe('compare block editing', () => {
  it('inserts an expanded block with a fresh id after the block holding the cursor', () => {
    const instance = load('first\n\nsecond')
    instance.commands.setTextSelection(3)
    instance.commands.insertCompareBlock()

    const nodes = instance.getJSON().content ?? []
    expect(nodes.map((node) => node.type)).toEqual(['paragraph', 'compareBlock', 'paragraph'])
    expect(nodes[1]?.attrs).toMatchObject({ collapsed: false, content: '' })
    expect(nodes[1]?.attrs?.id).toMatch(/^cb_[0-9a-f]{10}$/)
  })

  it('re-ids a pasted duplicate so two blocks never share stored content', () => {
    const instance = load(v1Sample)
    instance.commands.insertContentAt(0, {
      type: 'compareBlock',
      attrs: { id: 'cb_first01', collapsed: true, content: 'copy' }
    })

    const ids = compareBlocks(instance).map((block) => block.attrs?.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids.filter((id) => id === 'cb_first01')).toHaveLength(1)
    expect(Object.keys(v1.extractMeta(instance.getMarkdown())?.blocks ?? {})).toHaveLength(3)
  })
})
