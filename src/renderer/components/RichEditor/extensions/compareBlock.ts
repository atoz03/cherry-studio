import { Extension, type JSONContent, type MarkdownToken, mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import CompareBlockNodeView from '../components/CompareBlockNodeView'
import {
  appendCompareMeta,
  buildCompareMarkerLine,
  COMPARE_BLOCK_EDIT_META,
  type CompareBlockMeta,
  findCompareMarkerStart,
  findCompareMetaStart,
  matchCompareMarker,
  matchCompareMeta
} from '../helpers/compareBlockCodec'

export { COMPARE_BLOCK_EDIT_META }

const NODE_NAME = 'compareBlock'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    compareBlock: {
      /** Insert an expanded compare block after the top-level block holding the cursor. */
      insertCompareBlock: () => ReturnType
    }
  }
}

export const createCompareBlockId = (): string => `cb_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`

function forEachCompareToken(tokens: MarkdownToken[] | undefined, visit: (token: MarkdownToken) => void): void {
  for (const token of tokens ?? []) {
    if (token.type === NODE_NAME) visit(token)
    forEachCompareToken(token.tokens, visit)
    forEachCompareToken(token.items, visit)
  }
}

function collectCompareBlocks(node: JSONContent, blocks: CompareBlockMeta['blocks']): CompareBlockMeta['blocks'] {
  if (node.type === NODE_NAME) {
    const id = String(node.attrs?.id ?? '')
    if (id && !(id in blocks)) blocks[id] = { content: String(node.attrs?.content ?? '') }
  }
  node.content?.forEach((child) => collectCompareBlocks(child, blocks))
  return blocks
}

/**
 * Replaces StarterKit's `doc` node only to append the compare-block metadata footer, which belongs to
 * the whole file rather than to any single node.
 */
export const CompareBlockDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',

  renderMarkdown: (node, h) => {
    if (!node.content) return ''
    return appendCompareMeta(h.renderChildren(node.content, '\n\n'), collectCompareBlocks(node, {}))
  }
})

/**
 * Footer tag holding every block's content. It yields no node (an unhandled token with no children
 * parses to nothing): during lexing it copies each block's content onto the compare-block tokens
 * lexed before it, which only become nodes once lexing has finished.
 */
export const CompareBlockMetaFooter = Extension.create({
  name: 'compareBlockMeta',

  markdownTokenizer: {
    name: 'compareBlockMeta',
    level: 'block',
    start: findCompareMetaStart,
    tokenize(src: string, tokens: MarkdownToken[] = []) {
      const match = matchCompareMeta(src)
      if (!match) return undefined
      forEachCompareToken(tokens, (token) => {
        token.content = match.meta.blocks[token.id]?.content ?? ''
      })
      return { type: 'compareBlockMeta', raw: match.raw }
    }
  }
})

export const CompareBlock = Node.create({
  name: NODE_NAME,
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  markdownTokenizer: {
    name: NODE_NAME,
    level: 'block',
    start: findCompareMarkerStart,
    tokenize(src: string) {
      const marker = matchCompareMarker(src)
      if (!marker) return undefined
      return { type: NODE_NAME, raw: marker.raw, id: marker.id, collapsed: marker.collapsed, content: '' }
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode(NODE_NAME, {
      id: token.id,
      collapsed: token.collapsed,
      content: token.content ?? ''
    })
  },

  renderMarkdown(node) {
    const id = String(node.attrs?.id ?? '')
    return id ? buildCompareMarkerLine({ id, collapsed: node.attrs?.collapsed !== false }) : ''
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-id') ?? '',
        renderHTML: (attributes) => ({ 'data-id': attributes.id })
      },
      collapsed: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-collapsed') !== '0',
        renderHTML: (attributes) => ({ 'data-collapsed': attributes.collapsed ? '1' : '0' })
      },
      content: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-content') ?? '',
        renderHTML: (attributes) => ({ 'data-content': attributes.content })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="compare-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'compare-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CompareBlockNodeView)
  },

  addCommands() {
    return {
      insertCompareBlock:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          const insertPos = $from.depth > 0 ? $from.after(1) : state.selection.to
          const node = state.schema.nodes[NODE_NAME].create({ id: createCompareBlockId(), collapsed: false })
          if (dispatch) tr.insert(insertPos, node).scrollIntoView()
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    // Copy/paste and drag-duplicate keep the source id; contents are stored per id, so give every
    // later duplicate (or id-less block) a fresh id before the two can overwrite each other.
    return [
      new Plugin({
        key: new PluginKey('compareBlockUniqueIds'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          const seen = new Set<string>()
          const { tr } = newState
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== NODE_NAME) return
            const id = String(node.attrs.id ?? '')
            if (id && !seen.has(id)) {
              seen.add(id)
              return false
            }
            const nextId = createCompareBlockId()
            seen.add(nextId)
            tr.setNodeAttribute(pos, 'id', nextId)
            return false
          })
          return tr.docChanged ? tr : null
        }
      })
    ]
  }
})
