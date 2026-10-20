import { EditorContent } from '@tiptap/react'
import type { FC } from 'react'

import { useRichEditor } from '../useRichEditor'

// Nesting a compare block inside another one has no use, so the nested editor cannot insert one.
const DISABLED_COMMANDS = ['compareBlock'] as const

interface CompareBlockEditorProps {
  initialContent: string
  onChange: (markdown: string) => void
  placeholder: string
}

const CompareBlockEditor: FC<CompareBlockEditorProps> = ({ initialContent, onChange, placeholder }) => {
  const { editor } = useRichEditor({
    initialContent,
    onChange,
    placeholder,
    // Focusing on mount would let the trailing-node fix-up re-serialize content the user never touched.
    autoFocus: false,
    disabledCommands: DISABLED_COMMANDS
  })

  return (
    <EditorContent
      editor={editor}
      className="max-h-80 min-h-40 overflow-auto px-3 py-2 [&_.ProseMirror]:min-h-36 [&_.ProseMirror]:outline-none"
    />
  )
}

export default CompareBlockEditor
