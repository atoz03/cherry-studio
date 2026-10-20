import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import React, { lazy, Suspense, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

import { COMPARE_BLOCK_EDIT_META } from '../helpers/compareBlockCodec'

const CompareBlockEditor = lazy(() => import('./CompareBlockEditor'))

const CompareBlockNodeView: React.FC<NodeViewProps> = ({ node, editor, getPos }) => {
  const { t } = useTranslation()
  const isEditable = editor.isEditable
  const open = isEditable && node.attrs.collapsed === false
  const content = String(node.attrs.content ?? '')

  const setAttribute = useCallback(
    (name: 'collapsed' | 'content', value: boolean | string) => {
      const pos = getPos()
      if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos)?.attrs[name] === value) return
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, name, value).setMeta(COMPARE_BLOCK_EDIT_META, true))
    },
    [editor, getPos]
  )

  const toggleLabel = open ? t('richEditor.compareBlock.collapse') : t('richEditor.compareBlock.expand')

  return (
    <NodeViewWrapper data-type="compare-block" className="my-2" contentEditable={false}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={toggleLabel}
        title={toggleLabel}
        disabled={!isEditable}
        // Keep ProseMirror from moving its selection onto the atom when the toggle is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setAttribute('collapsed', open)}
        className="flex h-7 w-full items-center gap-2 rounded-sm px-1 text-muted-foreground outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:hover:bg-transparent">
        <span className="h-px flex-1 bg-border" />
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="h-px flex-1 bg-border" />
      </button>
      {open && (
        <div className="mt-1 overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-border border-b px-3 py-1">
            <span className="select-none text-muted-foreground text-xs">{t('richEditor.compareBlock.title')}</span>
            <Button variant="ghost" size="sm" onClick={() => setAttribute('collapsed', true)}>
              {t('richEditor.compareBlock.collapse')}
            </Button>
          </div>
          <Suspense fallback={<div className="p-3 text-muted-foreground text-xs">{t('common.loading')}</div>}>
            <CompareBlockEditor
              initialContent={content}
              onChange={(markdown) => setAttribute('content', markdown)}
              placeholder={t('richEditor.compareBlock.placeholder')}
            />
          </Suspense>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default CompareBlockNodeView
