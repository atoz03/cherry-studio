import { DraggableVirtualList } from '@renderer/components/DraggableList'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { isMac } from '@renderer/config/constant'
import { db } from '@renderer/databases'
import { useAssistant, useAssistants } from '@renderer/hooks/useAssistant'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { finishTopicRenaming, startTopicRenaming, TopicManager } from '@renderer/hooks/useTopic'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { RootState } from '@renderer/store'
import store from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import { setGenerating } from '@renderer/store/runtime'
import type { Assistant, Topic } from '@renderer/types'
import { classNames, removeSpecialCharactersForFileName, uuid } from '@renderer/utils'
import { copyTopicAsMarkdown, copyTopicAsPlainText } from '@renderer/utils/copy'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportTopicAsMarkdown,
  exportTopicToNotes,
  exportTopicToNotion,
  topicToMarkdown
} from '@renderer/utils/export'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { sortTopicsByPinnedAndCreatedAt } from '@renderer/utils/topicSort'
import type { MenuProps } from 'antd'
import { Dropdown, Tooltip } from 'antd'
import type { ItemType, MenuItemType } from 'antd/es/menu/interface'
import dayjs from 'dayjs'
import { findIndex } from 'lodash'
import {
  BrushCleaning,
  CheckSquare,
  FolderOpen,
  HelpCircle,
  MenuIcon,
  NotebookPen,
  PackagePlus,
  PinIcon,
  PinOffIcon,
  Save,
  Sparkles,
  Square,
  UploadIcon,
  XIcon
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import styled from 'styled-components'

import AddButton from './AddButton'

interface Props {
  assistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
}

export const Topics: React.FC<Props> = ({ assistant: _assistant, activeTopic, setActiveTopic, position }) => {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const { assistants } = useAssistants()
  const { assistant, addTopic, removeTopic, moveTopic, updateTopic, updateTopics } = useAssistant(_assistant.id)
  const { showTopicTime, setTopicPosition, topicPosition } = useSettings()

  const renamingTopics = useSelector((state: RootState) => state.runtime.chat.renamingTopics)
  const topicLoadingQuery = useSelector((state: RootState) => state.messages.loadingByTopic)
  const topicFulfilledQuery = useSelector((state: RootState) => state.messages.fulfilledByTopic)
  const newlyRenamedTopics = useSelector((state: RootState) => state.runtime.chat.newlyRenamedTopics)

  const borderRadius = showTopicTime ? 12 : 'var(--list-item-border-radius)'

  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null)
  const deleteTimerRef = useRef<NodeJS.Timeout>(null)
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null)
  const [isMultiSelecting, setIsMultiSelecting] = useState(false)
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])

  const { startEdit, isEditing, inputProps } = useInPlaceEdit({
    onSave: (name: string) => {
      const topic = assistant.topics.find((t) => t.id === editingTopicId)
      if (topic && name !== topic.name) {
        const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
        updateTopic(updatedTopic)
        window.toast.success(t('common.saved'))
      }
      setEditingTopicId(null)
    },
    onCancel: () => {
      setEditingTopicId(null)
    }
  })

  const isPending = useCallback((topicId: string) => topicLoadingQuery[topicId], [topicLoadingQuery])
  const isFulfilled = useCallback((topicId: string) => topicFulfilledQuery[topicId], [topicFulfilledQuery])
  const dispatch = useDispatch()

  useEffect(() => {
    dispatch(newMessagesActions.setTopicFulfilled({ topicId: activeTopic.id, fulfilled: false }))
  }, [activeTopic.id, dispatch, topicFulfilledQuery])

  const isRenaming = useCallback(
    (topicId: string) => {
      return renamingTopics.includes(topicId)
    },
    [renamingTopics]
  )

  const isNewlyRenamed = useCallback(
    (topicId: string) => {
      return newlyRenamedTopics.includes(topicId)
    },
    [newlyRenamedTopics]
  )

  const getNameKey = useCallback((topic: Topic) => topic.name?.toLowerCase?.() || '', [])

  const sortedTopics = useMemo(() => {
    return sortTopicsByPinnedAndCreatedAt(assistant.topics)
  }, [assistant.topics])

  const sortSelection = useCallback(
    (ids: string[]) => {
      const order = new Map(sortedTopics.map((topic, index) => [topic.id, index]))
      return [...new Set(ids)].filter((id) => order.has(id)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    },
    [sortedTopics]
  )

  const handleSelectAll = useCallback(() => {
    setSelectedTopicIds(sortedTopics.map((topic) => topic.id))
  }, [sortedTopics])

  const handleSelectAllUnique = useCallback(() => {
    const topicMap = new Map(sortedTopics.map((topic) => [topic.id, topic]))
    const normalizeName = (topic: Topic) => removeSpecialCharactersForFileName(getNameKey(topic)).trim() || topic.id
    const mergedIds = [...selectedTopicIds, ...sortedTopics.map((topic) => topic.id)]
    const seen = new Set<string>()
    const deduped: string[] = []

    for (const id of mergedIds) {
      const topic = topicMap.get(id)
      if (!topic) continue
      const key = normalizeName(topic).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(id)
    }

    setSelectedTopicIds(sortSelection(deduped))
  }, [getNameKey, selectedTopicIds, sortSelection, sortedTopics])

  const clearSelection = useCallback(() => {
    setSelectedTopicIds([])
  }, [])

  const toggleSelection = useCallback(
    (topicId: string) => {
      setSelectedTopicIds((prev) => {
        if (prev.includes(topicId)) {
          return prev.filter((id) => id !== topicId)
        }
        return sortSelection([...prev, topicId])
      })
    },
    [sortSelection]
  )

  const exitMultiSelect = useCallback(() => {
    setIsMultiSelecting(false)
    setSelectedTopicIds([])
  }, [])

  const enterMultiSelect = useCallback(
    (topicId?: string) => {
      setIsMultiSelecting(true)
      setSelectedTopicIds((prev) => sortSelection([...(topicId ? [topicId] : []), ...prev]))
    },
    [sortSelection]
  )

  useEffect(() => {
    if (!isMultiSelecting) return
    setSelectedTopicIds((prev) => {
      const next = sortSelection(prev)
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev
      return next
    })
  }, [isMultiSelecting, sortSelection])

  const selectedTopics = useMemo(
    () => sortedTopics.filter((topic) => selectedTopicIds.includes(topic.id)),
    [selectedTopicIds, sortedTopics]
  )

  const handleDeleteClick = useCallback((topicId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current)
    }

    setDeletingTopicId(topicId)

    deleteTimerRef.current = setTimeout(() => setDeletingTopicId(null), 2000)
  }, [])

  const onClearMessages = useCallback((topic: Topic) => {
    // window.keyv.set(EVENT_NAMES.CHAT_COMPLETION_PAUSED, true)
    store.dispatch(setGenerating(false))
    EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleConfirmDelete = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.stopPropagation()
      if (assistant.topics.length === 1) {
        const newTopic = getDefaultTopic(assistant.id)
        await db.topics.add({ id: newTopic.id, messages: [] })
        addTopic(newTopic)
        setActiveTopic(newTopic)
      } else {
        const index = findIndex(assistant.topics, (t) => t.id === topic.id)
        if (topic.id === activeTopic.id) {
          setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? index - 1 : index + 1])
        }
      }
      await modelGenerating()
      removeTopic(topic)
      setDeletingTopicId(null)
    },
    [activeTopic.id, addTopic, assistant.id, assistant.topics, removeTopic, setActiveTopic]
  )

  const onPinTopic = useCallback(
    (topic: Topic) => {
      const updatedTopic = { ...topic, pinned: !topic.pinned }
      updateTopic(updatedTopic)
    },
    [updateTopic]
  )

  const onDeleteTopic = useCallback(
    async (topic: Topic) => {
      await modelGenerating()
      if (topic.id === activeTopic?.id) {
        const index = findIndex(assistant.topics, (t) => t.id === topic.id)
        setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? index - 1 : index + 1])
      }
      removeTopic(topic)
    },
    [assistant.topics, removeTopic, setActiveTopic, activeTopic]
  )

  const onMoveTopic = useCallback(
    async (topic: Topic, toAssistant: Assistant) => {
      await modelGenerating()
      const index = findIndex(assistant.topics, (t) => t.id === topic.id)
      setActiveTopic(assistant.topics[index + 1 === assistant.topics.length ? 0 : index + 1])
      moveTopic(topic, toAssistant)
    },
    [assistant.topics, moveTopic, setActiveTopic]
  )

  const onSwitchTopic = useCallback(
    async (topic: Topic) => {
      // await modelGenerating()
      setActiveTopic(topic)
    },
    [setActiveTopic]
  )

  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

  const [_targetTopic, setTargetTopic] = useState<Topic | null>(null)
  const targetTopic = useDeferredValue(_targetTopic)
  const getTopicMenuItems = useMemo(() => {
    const topic = targetTopic
    if (!topic) return []

    const isSelected = selectedTopicIds.includes(topic.id)
    const multiSelectItems: ItemType<MenuItemType>[] = (
      [
        {
          label: isMultiSelecting ? t('chat.topics.multi_select.exit') : t('chat.topics.multi_select.label'),
          key: 'multi-select-toggle',
          icon: <CheckSquare size={14} />,
          onClick() {
            if (isMultiSelecting) {
              exitMultiSelect()
            } else {
              enterMultiSelect(topic.id)
            }
          }
        },
        isMultiSelecting && {
          label: isSelected ? t('chat.topics.multi_select.unselect') : t('chat.topics.multi_select.select'),
          key: 'toggle-select',
          icon: isSelected ? <Square size={14} /> : <CheckSquare size={14} />,
          onClick() {
            toggleSelection(topic.id)
          }
        },
        isMultiSelecting && {
          label: t('chat.topics.multi_select.select_all'),
          key: 'select-all',
          onClick: handleSelectAll
        },
        isMultiSelecting && {
          label: t('chat.topics.multi_select.clear'),
          key: 'clear-selection',
          onClick: clearSelection
        }
      ] as Array<ItemType<MenuItemType> | false>
    ).filter(Boolean) as ItemType<MenuItemType>[]

    const menus: MenuProps['items'] = [
      ...multiSelectItems,
      ...(multiSelectItems.length ? ([{ type: 'divider' }] as ItemType<MenuItemType>[]) : []),
      {
        label: t('chat.topics.auto_rename'),
        key: 'auto-rename',
        icon: <Sparkles size={14} />,
        disabled: isRenaming(topic.id),
        async onClick() {
          const messages = await TopicManager.getTopicMessages(topic.id)
          if (messages.length >= 2) {
            startTopicRenaming(topic.id)
            try {
              const summaryText = await fetchMessagesSummary({ messages, assistant })
              if (summaryText) {
                const updatedTopic = { ...topic, name: summaryText, isNameManuallyEdited: false }
                updateTopic(updatedTopic)
              } else {
                window.toast?.error(t('message.error.fetchTopicName'))
              }
            } finally {
              finishTopicRenaming(topic.id)
            }
          }
        }
      },
      {
        label: t('chat.topics.edit.title'),
        key: 'rename',
        icon: <EditIcon size={14} />,
        disabled: isRenaming(topic.id),
        async onClick() {
          const name = await PromptPopup.show({
            title: t('chat.topics.edit.title'),
            message: '',
            defaultValue: topic?.name || '',
            extraNode: (
              <div style={{ color: 'var(--color-text-3)', marginTop: 8 }}>{t('chat.topics.edit.title_tip')}</div>
            )
          })
          if (name && topic?.name !== name) {
            const updatedTopic = { ...topic, name, isNameManuallyEdited: true }
            updateTopic(updatedTopic)
          }
        }
      },
      {
        label: t('chat.topics.prompt.label'),
        key: 'topic-prompt',
        icon: <PackagePlus size={14} />,
        extra: (
          <Tooltip title={t('chat.topics.prompt.tips')}>
            <HelpCircle size={14} />
          </Tooltip>
        ),
        async onClick() {
          const prompt = await PromptPopup.show({
            title: t('chat.topics.prompt.edit.title'),
            message: '',
            defaultValue: topic?.prompt || '',
            inputProps: {
              rows: 8,
              allowClear: true
            }
          })

          prompt !== null &&
            (() => {
              const updatedTopic = { ...topic, prompt: prompt.trim() }
              updateTopic(updatedTopic)
              topic.id === activeTopic.id && setActiveTopic(updatedTopic)
            })()
        }
      },
      {
        label: topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin'),
        key: 'pin',
        icon: topic.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />,
        onClick() {
          onPinTopic(topic)
        }
      },
      {
        label: t('notes.save'),
        key: 'notes',
        icon: <NotebookPen size={14} />,
        onClick: async () => {
          exportTopicToNotes(topic, notesPath)
        }
      },
      {
        label: t('chat.topics.clear.title'),
        key: 'clear-messages',
        icon: <BrushCleaning size={14} />,
        onClick: () => onClearMessages(topic)
      },
      {
        label: t('settings.topic.position.label'),
        key: 'topic-position',
        icon: <MenuIcon size={14} />,
        children: [
          {
            label: t('settings.topic.position.left'),
            key: 'left',
            onClick: () => setTopicPosition('left')
          },
          {
            label: t('settings.topic.position.right'),
            key: 'right',
            onClick: () => setTopicPosition('right')
          }
        ]
      },
      {
        label: t('chat.topics.copy.title'),
        key: 'copy',
        icon: <CopyIcon size={14} />,
        children: [
          {
            label: t('chat.topics.copy.image'),
            key: 'img',
            onClick: () => EventEmitter.emit(EVENT_NAMES.COPY_TOPIC_IMAGE, topic)
          },
          {
            label: t('chat.topics.copy.md'),
            key: 'md',
            onClick: () => copyTopicAsMarkdown(topic)
          },
          {
            label: t('chat.topics.copy.plain_text'),
            key: 'plain_text',
            onClick: () => copyTopicAsPlainText(topic)
          }
        ]
      },
      {
        label: t('chat.save.label'),
        key: 'save',
        icon: <Save size={14} />,
        children: [
          {
            label: t('chat.save.topic.knowledge.title'),
            key: 'knowledge',
            onClick: async () => {
              try {
                const result = await SaveToKnowledgePopup.showForTopic(topic)
                if (result?.success) {
                  window.toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
                }
              } catch {
                window.toast.error(t('chat.save.topic.knowledge.error.save_failed'))
              }
            }
          }
        ]
      },
      {
        label: t('chat.topics.export.title'),
        key: 'export',
        icon: <UploadIcon size={14} />,
        children: [
          exportMenuOptions.image && {
            label: t('chat.topics.export.image'),
            key: 'image',
            onClick: () => EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)
          },
          exportMenuOptions.markdown && {
            label: t('chat.topics.export.md.label'),
            key: 'markdown',
            onClick: () => exportTopicAsMarkdown(topic)
          },
          exportMenuOptions.markdown_reason && {
            label: t('chat.topics.export.md.reason'),
            key: 'markdown_reason',
            onClick: () => exportTopicAsMarkdown(topic, true)
          },
          exportMenuOptions.docx && {
            label: t('chat.topics.export.word'),
            key: 'word',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
            }
          },
          exportMenuOptions.notion && {
            label: t('chat.topics.export.notion'),
            key: 'notion',
            onClick: async () => {
              exportTopicToNotion(topic)
            }
          },
          exportMenuOptions.yuque && {
            label: t('chat.topics.export.yuque'),
            key: 'yuque',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              exportMarkdownToYuque(topic.name, markdown)
            }
          },
          exportMenuOptions.obsidian && {
            label: t('chat.topics.export.obsidian'),
            key: 'obsidian',
            onClick: async () => {
              await ObsidianExportPopup.show({ title: topic.name, topic, processingMethod: '3' })
            }
          },
          exportMenuOptions.joplin && {
            label: t('chat.topics.export.joplin'),
            key: 'joplin',
            onClick: async () => {
              const topicMessages = await TopicManager.getTopicMessages(topic.id)
              exportMarkdownToJoplin(topic.name, topicMessages)
            }
          },
          exportMenuOptions.siyuan && {
            label: t('chat.topics.export.siyuan'),
            key: 'siyuan',
            onClick: async () => {
              const markdown = await topicToMarkdown(topic)
              exportMarkdownToSiyuan(topic.name, markdown)
            }
          }
        ].filter(Boolean) as ItemType<MenuItemType>[]
      }
    ]

    if (assistants.length > 1 && assistant.topics.length > 1) {
      menus.push({
        label: t('chat.topics.move_to'),
        key: 'move',
        icon: <FolderOpen size={14} />,
        children: assistants
          .filter((a) => a.id !== assistant.id)
          .map((a) => ({
            label: a.name,
            key: a.id,
            onClick: () => onMoveTopic(topic, a)
          }))
      })
    }

    if (assistant.topics.length > 1 && !topic.pinned) {
      menus.push({ type: 'divider' })
      menus.push({
        label: t('common.delete'),
        danger: true,
        key: 'delete',
        icon: <DeleteIcon size={14} className="lucide-custom" />,
        onClick: () => onDeleteTopic(topic)
      })
    }

    return menus
  }, [
    targetTopic,
    t,
    isRenaming,
    exportMenuOptions.image,
    exportMenuOptions.markdown,
    exportMenuOptions.markdown_reason,
    exportMenuOptions.docx,
    exportMenuOptions.notion,
    exportMenuOptions.yuque,
    exportMenuOptions.obsidian,
    exportMenuOptions.joplin,
    exportMenuOptions.siyuan,
    assistants,
    handleSelectAll,
    toggleSelection,
    clearSelection,
    notesPath,
    assistant,
    enterMultiSelect,
    exitMultiSelect,
    isMultiSelecting,
    selectedTopicIds,
    updateTopic,
    activeTopic.id,
    setActiveTopic,
    onPinTopic,
    onClearMessages,
    setTopicPosition,
    onMoveTopic,
    onDeleteTopic
  ])

  const moveTargets = useMemo(() => {
    const getTopicCreatedTimestampMs = (topic: Topic) => {
      const created = Date.parse(topic.createdAt || '')
      if (Number.isFinite(created)) return created
      const updated = Date.parse(topic.updatedAt || '')
      return Number.isFinite(updated) ? updated : 0
    }

    const getLatestTimestamp = (assistantItem: Assistant) =>
      assistantItem.topics.reduce((acc, topic) => Math.max(acc, getTopicCreatedTimestampMs(topic)), 0)
    return assistants
      .filter((item) => item.id !== assistant.id)
      .sort((a, b) => getLatestTimestamp(b) - getLatestTimestamp(a))
  }, [assistant.id, assistants])

  const handleMoveSelected = useCallback(
    async (toAssistant: Assistant) => {
      if (!selectedTopics.length) {
        window.toast?.warning(t('chat.topics.multi_select.empty'))
        return
      }

      const movingIds = new Set(selectedTopics.map((topic) => topic.id))
      const remainingTopics = assistant.topics.filter((topic) => !movingIds.has(topic.id))

      selectedTopics.forEach((topic) => {
        moveTopic(topic, toAssistant)
      })

      if (movingIds.has(activeTopic.id)) {
        if (remainingTopics.length) {
          setActiveTopic(remainingTopics[0])
        } else {
          const newTopic = getDefaultTopic(assistant.id)
          await db.topics.add({ id: newTopic.id, messages: [] })
          addTopic(newTopic)
          setActiveTopic(newTopic)
        }
      }

      exitMultiSelect()
      window.toast?.success(t('common.saved'))
    },
    [
      activeTopic.id,
      addTopic,
      assistant.id,
      assistant.topics,
      exitMultiSelect,
      moveTopic,
      selectedTopics,
      setActiveTopic,
      t
    ]
  )

  const moveMenuItems: MenuProps['items'] = useMemo(
    () =>
      moveTargets.map((item) => ({
        label: item.name,
        key: item.id,
        onClick: () => handleMoveSelected(item)
      })),
    [handleMoveSelected, moveTargets]
  )

  const handleBatchDelete = useCallback(async () => {
    if (!selectedTopics.length) {
      window.toast?.warning(t('chat.topics.multi_select.empty'))
      return
    }

    await modelGenerating()
    const deletingIds = new Set(selectedTopics.map((topic) => topic.id))
    const remainingTopics = assistant.topics.filter((topic) => !deletingIds.has(topic.id))

    if (deletingIds.has(activeTopic.id)) {
      if (remainingTopics.length) {
        setActiveTopic(remainingTopics[0])
      } else {
        const newTopic = getDefaultTopic(assistant.id)
        await db.topics.add({ id: newTopic.id, messages: [] })
        addTopic(newTopic)
        setActiveTopic(newTopic)
      }
    }

    for (const topic of selectedTopics) {
      await removeTopic(topic)
    }

    setDeletingTopicId(null)
    exitMultiSelect()
  }, [
    activeTopic.id,
    addTopic,
    assistant.id,
    assistant.topics,
    exitMultiSelect,
    removeTopic,
    selectedTopics,
    setActiveTopic,
    t
  ])

  // 按 ChatGPT conversations.json 线性结构构造 mapping，确保导出可被现有导入逻辑识别
  const buildChatGPTConversation = useCallback(async (topic: Topic) => {
    const mapRole = (role: string): 'user' | 'assistant' | 'system' => {
      if (role === 'assistant') return 'assistant'
      if (role === 'system') return 'system'
      return 'user'
    }

    const topicMessages = await TopicManager.getTopicMessages(topic.id)
    const mapping: Record<string, any> = {}
    const rootId = uuid()
    mapping[rootId] = { id: rootId, message: null, parent: null, children: [] }
    let lastId = rootId

    topicMessages.forEach((message) => {
      const content = getMainTextContent(message) || ''
      if (!content.trim()) return
      const messageId = uuid()
      mapping[lastId].children.push(messageId)
      const createdSeconds = message.createdAt ? Math.floor(new Date(message.createdAt).getTime() / 1000) : undefined
      mapping[messageId] = {
        id: messageId,
        message: {
          id: messageId,
          author: { role: mapRole(message.role) },
          content: { content_type: 'text', parts: [content] },
          create_time: createdSeconds
        },
        parent: lastId,
        children: []
      }
      lastId = messageId
    })

    const createTime = Math.floor(new Date(topic.createdAt || Date.now()).getTime() / 1000)
    const updateTime = Math.floor(new Date(topic.updatedAt || topic.createdAt || Date.now()).getTime() / 1000)

    return {
      title: topic.name,
      create_time: createTime,
      update_time: updateTime,
      mapping,
      current_node: lastId !== rootId ? lastId : undefined
    }
  }, [])

  const handleExportSelected = useCallback(async () => {
    if (!selectedTopics.length) {
      window.toast?.warning(t('chat.topics.multi_select.empty'))
      return
    }

    const conversations: Array<{
      title: string
      create_time: number
      update_time: number
      mapping: Record<string, any>
      current_node?: string
    }> = []
    for (const topic of selectedTopics) {
      const conversation = await buildChatGPTConversation(topic)
      conversations.push(conversation)
    }

    const fileName = `${removeSpecialCharactersForFileName(assistant.name)}-${Date.now()}.json`
    await window.api.file.save(fileName, JSON.stringify(conversations, null, 2))
    window.toast?.success(t('common.saved'))
  }, [assistant.name, buildChatGPTConversation, selectedTopics, t])

  const handleBatchRename = useCallback(async () => {
    if (!selectedTopics.length) {
      window.toast?.warning(t('chat.topics.multi_select.empty'))
      return
    }

    const concurrency = 5
    let cursor = 0

    const runNext = async () => {
      while (cursor < selectedTopics.length) {
        const current = selectedTopics[cursor++]
        if (!current) return

        try {
          startTopicRenaming(current.id)
          const messages = await TopicManager.getTopicMessages(current.id)
          if (!messages.length) {
            window.toast?.warning(t('chat.topics.multi_select.batch_rename_skip_empty', { name: current.name }))
            continue
          }

          const summaryText = await fetchMessagesSummary({ messages, assistant })
          if (summaryText) {
            const updatedTopic = { ...current, name: summaryText, isNameManuallyEdited: false }
            updateTopic(updatedTopic)
            window.toast?.success(t('chat.topics.multi_select.batch_rename_success', { name: summaryText }))
          } else {
            window.toast?.error(t('chat.topics.multi_select.batch_rename_failed', { name: current.name }))
          }
        } catch (error) {
          window.toast?.error(t('chat.topics.multi_select.batch_rename_failed', { name: current.name }))
        } finally {
          finishTopicRenaming(current.id)
        }
      }
    }

    await Promise.allSettled(Array.from({ length: Math.min(concurrency, selectedTopics.length) }, runNext))
  }, [assistant, selectedTopics, t, updateTopic])

  const singlealone = topicPosition === 'right' && position === 'right'

  return (
    <DraggableVirtualList
      className="topics-tab"
      list={sortedTopics}
      onUpdate={updateTopics}
      style={{ height: '100%', padding: '9px 0 10px 10px' }}
      itemContainerStyle={{ paddingBottom: '8px' }}
      disabled={isMultiSelecting}
      header={
        isMultiSelecting ? (
          <ActionBar>
            <div className="count">
              {t('chat.topics.multi_select.selected_count', { count: selectedTopicIds.length })}
            </div>
            <ActionButtons>
              <ActionButton onClick={handleSelectAll}>{t('chat.topics.multi_select.select_all')}</ActionButton>
              <ActionButton onClick={handleSelectAllUnique}>
                {t('chat.topics.multi_select.select_all_unique')}
              </ActionButton>
              <ActionButton onClick={clearSelection}>{t('chat.topics.multi_select.clear')}</ActionButton>
              <Dropdown
                menu={{ items: moveMenuItems }}
                trigger={['click']}
                disabled={!selectedTopics.length || !moveMenuItems.length}>
                <ActionButton disabled={!selectedTopics.length || !moveMenuItems.length}>
                  {t('chat.topics.multi_select.move')}
                </ActionButton>
              </Dropdown>
              <ActionButton danger onClick={handleBatchDelete} disabled={!selectedTopics.length}>
                {t('chat.topics.multi_select.delete')}
              </ActionButton>
              <ActionButton onClick={handleExportSelected} disabled={!selectedTopics.length}>
                {t('chat.topics.multi_select.export')}
              </ActionButton>
              <ActionButton onClick={handleBatchRename} disabled={!selectedTopics.length}>
                {t('chat.topics.multi_select.batch_rename')}
              </ActionButton>
              <ActionButton onClick={exitMultiSelect}>{t('chat.topics.multi_select.exit')}</ActionButton>
            </ActionButtons>
          </ActionBar>
        ) : (
          <>
            <AddButton onClick={() => EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)}>
              {t('chat.add.topic.title')}
            </AddButton>
            <div className="my-1"></div>
          </>
        )
      }>
      {(topic) => {
        const isActive = topic.id === activeTopic?.id
        const topicName = topic.name.replace('`', '')
        const topicPrompt = topic.prompt
        const fullTopicPrompt = t('common.prompt') + ': ' + topicPrompt

        const getTopicNameClassName = () => {
          if (isRenaming(topic.id)) return 'shimmer'
          if (isNewlyRenamed(topic.id)) return 'typing'
          return ''
        }

        return (
          <Dropdown menu={{ items: getTopicMenuItems }} trigger={['contextMenu']}>
            <TopicListItem
              onContextMenu={() => setTargetTopic(topic)}
              className={classNames(
                isActive ? 'active' : '',
                singlealone ? 'singlealone' : '',
                selectedTopicIds.includes(topic.id) ? 'selected' : ''
              )}
              onClick={
                editingTopicId === topic.id && isEditing
                  ? undefined
                  : () => {
                      if (isMultiSelecting) {
                        toggleSelection(topic.id)
                        return
                      }
                      onSwitchTopic(topic)
                    }
              }
              style={{
                borderRadius,
                cursor: editingTopicId === topic.id && isEditing ? 'default' : 'pointer'
              }}>
              {isPending(topic.id) && !isActive && <PendingIndicator />}
              {isFulfilled(topic.id) && !isActive && <FulfilledIndicator />}
              <TopicNameContainer>
                {isMultiSelecting && (
                  <MultiSelectCheckbox
                    aria-label="multi-select-checkbox"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSelection(topic.id)
                    }}>
                    {selectedTopicIds.includes(topic.id) ? (
                      <CheckSquare size={14} color="var(--color-primary)" />
                    ) : (
                      <Square size={14} color="var(--color-text-3)" />
                    )}
                  </MultiSelectCheckbox>
                )}
                {editingTopicId === topic.id && isEditing ? (
                  <TopicEditInput {...inputProps} onClick={(e) => e.stopPropagation()} />
                ) : (
                  <TopicName
                    className={getTopicNameClassName()}
                    title={topicName}
                    onDoubleClick={() => {
                      if (isMultiSelecting) return
                      setEditingTopicId(topic.id)
                      startEdit(topic.name)
                    }}>
                    {topicName}
                  </TopicName>
                )}
                {!topic.pinned && (
                  <Tooltip
                    placement="bottom"
                    mouseEnterDelay={0.7}
                    mouseLeaveDelay={0}
                    title={
                      <div style={{ fontSize: '12px', opacity: 0.8, fontStyle: 'italic' }}>
                        {t('chat.topics.delete.shortcut', { key: isMac ? '⌘' : 'Ctrl' })}
                      </div>
                    }>
                    <MenuButton
                      className="menu"
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          handleConfirmDelete(topic, e)
                        } else if (deletingTopicId === topic.id) {
                          handleConfirmDelete(topic, e)
                        } else {
                          handleDeleteClick(topic.id, e)
                        }
                      }}>
                      {deletingTopicId === topic.id ? (
                        <DeleteIcon size={14} color="var(--color-error)" style={{ pointerEvents: 'none' }} />
                      ) : (
                        <XIcon size={14} color="var(--color-text-3)" style={{ pointerEvents: 'none' }} />
                      )}
                    </MenuButton>
                  </Tooltip>
                )}
                {topic.pinned && (
                  <MenuButton className="pin">
                    <PinIcon size={14} color="var(--color-text-3)" />
                  </MenuButton>
                )}
              </TopicNameContainer>
              {topicPrompt && (
                <TopicPromptText className="prompt" title={fullTopicPrompt}>
                  {fullTopicPrompt}
                </TopicPromptText>
              )}
              {showTopicTime && (
                <TopicTime className="time">{dayjs(topic.createdAt).format('YYYY/MM/DD HH:mm')}</TopicTime>
              )}
            </TopicListItem>
          </Dropdown>
        )
      }}
    </DraggableVirtualList>
  )
}

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  gap: 12px;
  color: var(--color-text-2);
  background: var(--color-list-item);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
  margin: 0 6px 8px 0;

  .count {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-1);
  }
`

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`

const ActionButton = styled.button<{ danger?: boolean }>`
  border: 1px solid ${({ danger }) => (danger ? 'var(--color-error)' : 'var(--color-border)')};
  background: ${({ danger }) => (danger ? 'rgba(255, 0, 0, 0.08)' : 'var(--color-background)')};
  color: ${({ danger }) => (danger ? 'var(--color-error)' : 'var(--color-text-1)')};
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.12s ease, color 0.12s ease;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  &:not(:disabled):hover {
    background: ${({ danger }) => (danger ? 'rgba(255, 0, 0, 0.15)' : 'var(--color-list-item-hover)')};
  }
`

const MultiSelectCheckbox = styled.button`
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  padding: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 6px;
`

const TopicListItem = styled.div`
  padding: 7px 12px;
  border-radius: var(--list-item-border-radius);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  width: calc(var(--assistants-width) - 20px);
  position: relative;
  gap: 4px;
  border: 1px solid transparent;

  .menu {
    opacity: 0;
    color: var(--color-text-3);
  }

  &:hover {
    background-color: var(--color-list-item-hover);
    transition: background-color 0.1s;

    .menu {
      opacity: 1;
    }
  }

  &.active {
    background-color: var(--color-list-item);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    .menu {
      opacity: 1;

      &:hover {
        color: var(--color-text-2);
      }
    }
  }
  &.selected {
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }
  &.singlealone {
    &:hover {
      background-color: var(--color-background-soft);
    }
    &.active {
      background-color: var(--color-background-mute);
      box-shadow: none;
    }
  }
`

const TopicNameContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;

  .menu,
  .pin {
    margin-left: auto;
  }
`

const TopicName = styled.div`
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  position: relative;
  will-change: background-position, width;

  --color-shimmer-mid: var(--color-text-1);
  --color-shimmer-end: color-mix(in srgb, var(--color-text-1) 25%, transparent);

  &.shimmer {
    background: linear-gradient(to left, var(--color-shimmer-end), var(--color-shimmer-mid), var(--color-shimmer-end));
    background-size: 200% 100%;
    background-clip: text;
    color: transparent;
    animation: shimmer 3s linear infinite;
  }

  &.typing {
    display: block;
    -webkit-line-clamp: unset;
    -webkit-box-orient: unset;
    white-space: nowrap;
    overflow: hidden;
    animation: typewriter 0.5s steps(40, end);
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes typewriter {
    from {
      width: 0;
    }
    to {
      width: 100%;
    }
  }
`

const TopicEditInput = styled.input`
  background: var(--color-background);
  border: none;
  color: var(--color-text-1);
  font-size: 13px;
  font-family: inherit;
  padding: 2px 6px;
  width: 100%;
  outline: none;
  padding: 0;
`

const PendingIndicator = styled.div.attrs({
  className: 'animation-pulse'
})`
  --pulse-size: 5px;
  width: 5px;
  height: 5px;
  position: absolute;
  left: 3px;
  top: 15px;
  border-radius: 50%;
  background-color: var(--color-status-warning);
`

const FulfilledIndicator = styled.div.attrs({
  className: 'animation-pulse'
})`
  --pulse-size: 5px;
  width: 5px;
  height: 5px;
  position: absolute;
  left: 3px;
  top: 15px;
  border-radius: 50%;
  background-color: var(--color-status-success);
`

const TopicPromptText = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  ~ .prompt-text {
    margin-top: 10px;
  }
`

const TopicTime = styled.div`
  color: var(--color-text-3);
  font-size: 11px;
`

const MenuButton = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  min-width: 20px;
  min-height: 20px;
  .anticon {
    font-size: 12px;
  }
`
