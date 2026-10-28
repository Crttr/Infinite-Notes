
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react'

import { NoteCard, type NoteNode } from './NoteCard'
import '@xyflow/react/dist/style.css'
import './App.css'
import { SmartEdge } from './SmartEdge'
import { RichTextEditor } from './RichText'
import { ImageGallery } from './ImageGallery'
import { saveImage, type GalleryImage } from './ImageStorage'
import { exportBackup, inspectBackup, importBackup, downloadBackup, type BackupPreview } from './Backup'

type LineShape = 'curve' | 'straight'
type LinePattern = 'solid' | 'dashed' | 'dotted'
type LineSettings = {
  shape: LineShape
  pattern: LinePattern
  color: string
  width: number
  arrow: boolean
  themeColor?: boolean // Цвет связи следует выбранной теме
}
const DEFAULT_LINE: LineSettings = {
  shape: 'straight', pattern: 'solid', color: '#c48bdf', width: 2.5, arrow: false, themeColor: true,
}
function lineSettings(edge: Edge): LineSettings {
  const saved = edge.data?.lineSettings as Partial<LineSettings> | undefined
  return { ...DEFAULT_LINE, ...saved }
}
function applyLineSettings(edge: Edge, settings: LineSettings): Edge {
  return {
    ...edge,
    type: 'smart',
    data: { ...edge.data, lineSettings: settings },
    style: { ...edge.style, stroke: settings.color, strokeWidth: settings.width },
    markerEnd: settings.arrow
      ? { type: MarkerType.ArrowClosed, color: settings.color }
      : undefined,
  }
}

type ThemeId = 'purple' | 'midnight' | 'forest' | 'sunset' | 'light' | 'graphite'
const THEME_KEY = 'infinite-notes-theme-v1'
const THEMES: { id: ThemeId; label: string; description: string; preview: string; accent: string }[] = [
  { id: 'purple', label: 'Infinite Purple', description: 'Оригинальная фиолетовая', preview: 'linear-gradient(160deg,#252329,#382c39 45%,#793b69)', accent: '#c48bdf' },
  { id: 'midnight', label: 'Midnight', description: 'Ночной синий', preview: 'linear-gradient(160deg,#161c2d,#283754 50%,#485b80)', accent: '#a5b9ef' },
  { id: 'forest', label: 'Forest', description: 'Лесная зелень', preview: 'linear-gradient(160deg,#182925,#294d42 50%,#447762)', accent: '#9cddbe' },
  { id: 'sunset', label: 'Sunset', description: 'Тёплый закат', preview: 'linear-gradient(160deg,#30242d,#62404a 50%,#a36d5a)', accent: '#f0b6a0' },
  { id: 'light', label: 'Light', description: 'Светлая лаванда', preview: 'linear-gradient(160deg,#f5f1f9,#e6deee 50%,#d4c3e5)', accent: '#8061a2' },
  { id: 'graphite', label: 'Graphite', description: 'Нейтральный графит', preview: 'linear-gradient(160deg,#1b1d21,#2e3137 50%,#4a4e58)', accent: '#b5bac8' },
]
function savedTheme(): ThemeId {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return THEMES.some((theme) => theme.id === value) ? value as ThemeId : 'purple'
  } catch { return 'purple' }
}

const NOTES_KEY = 'infinite-notes-v1'
const EDGES_KEY = 'infinite-notes-edges-v1'

const edgeTypes = {
  smart: SmartEdge,
}
const nodeTypes = {
  note: NoteCard,
}

type ConnectionSides = {
  sourceHandle: string
  targetHandle: string
}

// Выбираем стороны подключения двух заметок
function getConnectionSides(
  source: NoteNode,
  target: NoteNode
): ConnectionSides {
  // Размеры заметок
  const sourceWidth = source.measured?.width ?? 260
  const sourceHeight = source.measured?.height ?? (source.data.collapsed ? 54 : 150)

  const targetWidth = target.measured?.width ?? 260
  const targetHeight = target.measured?.height ?? (target.data.collapsed ? 54 : 150)

  // Центры заметок
  const sourceX = source.position.x + sourceWidth / 2
  const sourceY = source.position.y + sourceHeight / 2

  const targetX = target.position.x + targetWidth / 2
  const targetY = target.position.y + targetHeight / 2

  // Разница координат
  const dx = targetX - sourceX
  const dy = targetY - sourceY

  // Расстояние между границами карточек
  const horizontalGap =
    Math.abs(dx) - (sourceWidth + targetWidth) / 2

  const verticalGap =
    Math.abs(dy) - (sourceHeight + targetHeight) / 2

  // Выбираем направление с большим зазором
  if (horizontalGap >= verticalGap) {
    return dx >= 0
      ? {
          sourceHandle: 'source-right',
          targetHandle: 'target-left',
        }
      : {
          sourceHandle: 'source-left',
          targetHandle: 'target-right',
        }
  }

  return dy >= 0
    ? {
        sourceHandle: 'source-bottom',
        targetHandle: 'target-top',
      }
    : {
        sourceHandle: 'source-top',
        targetHandle: 'target-bottom',
      }
}


// Загружаем заметки из локального хранилища
function loadNotes(): NoteNode[] {
  try {
    const saved = localStorage.getItem(NOTES_KEY)
    if (!saved) return []

    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item): item is NoteNode => {
      return (
        item !== null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        item.type === 'note' &&
        typeof item.position?.x === 'number' &&
        typeof item.position?.y === 'number' &&
        typeof item.data?.title === 'string' &&
        typeof item.data?.content === 'string'
      )
    })
  } catch {
    return []
  }
}

// Загружаем сохранённые связи
function loadEdges(): Edge[] {
  try {
    const saved = localStorage.getItem(EDGES_KEY)
    if (!saved) return []

    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item): item is Edge => {
      return (
        item !== null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.source === 'string' &&
        typeof item.target === 'string'
      )
    })
  } catch {
    return []
  }
}

type ContextMenu =
  | {
      type: 'node'
      id: string
      x: number
      y: number
    }
  | {
      type: 'edge'
      id: string
      x: number
      y: number
    }

function Workspace() {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<NoteNode>(loadNotes())

  const [edges, setEdges, onEdgesChange] =
    useEdgesState<Edge>(
      loadEdges().filter(
        (edge) =>
          nodes.some((node) => node.id === edge.source) &&
          nodes.some((node) => node.id === edge.target)
      )
    )

  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpSection, setHelpSection] = useState<'start' | 'editor' | 'links' | 'images' | 'backup' | 'controls' | 'about'>('start')
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'connections' | 'backup'>('appearance')
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [themeId, setThemeId] = useState<ThemeId>(savedTheme)
  useEffect(() => { localStorage.setItem(THEME_KEY, themeId) }, [themeId])

  const [lineEditorId, setLineEditorId] = useState<string | null>(null)
  const [defaultLine, setDefaultLine] = useState<LineSettings>(() => {
    try { const saved = JSON.parse(localStorage.getItem('infinite-notes-line-defaults-v1') || '{}'); return { ...DEFAULT_LINE, ...saved, themeColor: saved.themeColor ?? (THEMES.some((t) => t.accent.toLowerCase() === String(saved.color ?? DEFAULT_LINE.color).toLowerCase())) } }
    catch { return DEFAULT_LINE }
  })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHighlightedId, setSearchHighlightedId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [linkSource, setLinkSource] = useState<string | null>(null)
  // Запоминаем фактическое начало перетаскивания связи.
  const dragOrigin = useRef<{ nodeId: string; handleType: string | null } | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorFullscreen, setEditorFullscreen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftHtml, setDraftHtml] = useState('')
  const [draftGallery, setDraftGallery] = useState<GalleryImage[]>([])
  const [draftKind, setDraftKind] = useState<'note' | 'gallery'>('note')
  const [galleryError, setGalleryError] = useState('')
  // Links to list items are kept separately from React Flow's note-to-note edges.
  type ItemLink = { id: string; sourceNoteId: string; itemId: string; targetNoteId: string; itemLabel: string }
  const ITEM_LINKS_KEY = 'infinite-notes-item-links-v1'
  const [itemLinks, setItemLinks] = useState<ItemLink[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('infinite-notes-item-links-v1') || '[]')
      return Array.isArray(value) ? value.filter((link): link is ItemLink =>
        typeof link === 'object' && link !== null &&
        typeof link.id === 'string' && typeof link.sourceNoteId === 'string' &&
        typeof link.itemId === 'string' && typeof link.targetNoteId === 'string' &&
        typeof link.itemLabel === 'string') : []
    } catch { return [] }
  })
  const [itemLinkDraft, setItemLinkDraft] = useState<{ itemId: string; itemLabel: string } | null>(null)
  const [itemLinkQuery, setItemLinkQuery] = useState('')
  const [itemLinkFeedback, setItemLinkFeedback] = useState('')
  const [pendingItemLinks, setPendingItemLinks] = useState<ItemLink[]>([])
  const [removedItemLinkIds, setRemovedItemLinkIds] = useState<string[]>([])
  useEffect(() => { localStorage.setItem(ITEM_LINKS_KEY, JSON.stringify(itemLinks)) }, [itemLinks])


  const { setViewport, setCenter, screenToFlowPosition } = useReactFlow()

  // Сохраняем заметки
  useEffect(() => {
    const savedNodes = nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        title: node.data.title,
        content: node.data.content,
        richHtml: node.data.richHtml,
        kind: node.data.kind,
        gallery: node.data.gallery,
        collapsed: node.data.collapsed ?? false,
      },
    }))

    localStorage.setItem(
      NOTES_KEY,
      JSON.stringify(savedNodes)
    )
  }, [nodes])

  useEffect(() => { localStorage.setItem('infinite-notes-line-defaults-v1', JSON.stringify(defaultLine)) }, [defaultLine])

  // Сохраняем связи
  useEffect(() => {
    localStorage.setItem(
      EDGES_KEY,
      JSON.stringify(edges)
    )
  }, [edges])


  // Перестраиваем связи при перемещении заметок
  useEffect(() => {
    setEdges((current) => {
      let changed = false

      const updated = current.map((edge) => {
        if (edge.data?.connectionMode === 'manual') {
          return edge
        }
        const source = nodes.find(
          (node) => node.id === edge.source
        )

        const target = nodes.find(
          (node) => node.id === edge.target
        )

        if (!source || !target) {
          return edge
        }

        // Ручные подключения сохраняют выбранные стороны.
        if (edge.data?.connectionMode === 'manual') return edge

        const sides = getConnectionSides(source, target)

        const needsUpdate =
          edge.sourceHandle !== sides.sourceHandle ||
          edge.targetHandle !== sides.targetHandle ||
          edge.type !== 'smart'

        if (!needsUpdate) {
          return edge
        }

        changed = true

        return {
          ...edge,
          sourceHandle: sides.sourceHandle,
          targetHandle: sides.targetHandle,
          type: 'smart',
        }
      })

      return changed ? updated : current
    })
  }, [nodes, setEdges])


  // Сворачиваем или разворачиваем заметку, не меняя её содержимое.
  const toggleNote = useCallback((id: string) => {
    setNodes((current) => current.map((node) =>
      node.id === id
        ? { ...node, data: { ...node.data, collapsed: !node.data.collapsed } }
        : node
    ))
  }, [setNodes])

  // Создаём новую заметку
  const addNote = useCallback(() => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })

    const newNote: NoteNode = {
      id: crypto.randomUUID(),
      type: 'note',
      position,
      data: {
        title: 'Новая заметка',
        content: '',
      },
    }

    setNodes((current) => [...current, newNote])
    setMenu(null)
  }, [screenToFlowPosition, setNodes])


  const addGallery = useCallback(() => {
    const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    setNodes(current => [...current, { id: crypto.randomUUID(), type: 'note', position,
      data: { title: 'Новая галерея', content: '', kind: 'gallery', gallery: [] } }])
  }, [screenToFlowPosition, setNodes])

  // Создаём связь перетаскиванием мыши
  

  // ЛКМ по заметке — завершаем создание связи
  
  const onNodeClick: NodeMouseHandler<NoteNode> =
    useCallback((_, node) => {
      setSelectedNoteId(node.id)
      if (!linkSource) return

      if (linkSource === node.id) return

      const sourceNode = nodes.find(
        (item) => item.id === linkSource
      )

      if (!sourceNode) {
        setLinkSource(null)
        return
      }

      const sides = getConnectionSides(sourceNode, node)

      setEdges((current) => {
        const exists = current.some(
          (edge) =>
            (edge.source === linkSource &&
              edge.target === node.id) ||
            (edge.source === node.id &&
              edge.target === linkSource)
        )

        if (exists) return current

        const newEdge: Edge = {
          id: crypto.randomUUID(),
          source: linkSource,
          target: node.id,

          sourceHandle: sides.sourceHandle,
          targetHandle: sides.targetHandle,

          type: 'smart',
          animated: false,

          style: {
            stroke: '#c48bdf',
            strokeWidth: 2.5,
          },

          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#c48bdf',
          },
        }

        return [...current, applyLineSettings(newEdge, defaultLine)]
      })

      setLinkSource(null)
      setMenu(null)
    }, [linkSource, nodes, setEdges, defaultLine])


  // Перетаскивание от точки одной заметки к точке другой.
  const onConnect = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return
    if (!connection.sourceHandle || !connection.targetHandle) return

    // React Flow может считать исходной точкой source, даже если пользователь
    // начал перетаскивание с target. Восстанавливаем направление жеста.
    const startedAtTarget =
      dragOrigin.current?.handleType === 'target' &&
      dragOrigin.current.nodeId === connection.target

    const directed: Connection = startedAtTarget
      ? {
          source: connection.target,
          sourceHandle: connection.targetHandle.replace(/^target-/, 'source-'),
          target: connection.source,
          targetHandle: connection.sourceHandle.replace(/^source-/, 'target-'),
        }
      : connection

    dragOrigin.current = null

    setEdges((current) => {
      // Не создаём вторую связь между той же парой заметок.
      const exists = current.some((edge) =>
        (edge.source === directed.source && edge.target === directed.target) ||
        (edge.source === directed.target && edge.target === directed.source)
      )
      if (exists) return current

      const newEdge: Edge = {
        ...directed,
        id: crypto.randomUUID(),
        type: 'smart',
        animated: false,
        data: { connectionMode: 'manual' },
        style: { stroke: '#c48bdf', strokeWidth: 2.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#c48bdf',
        },
      }
      return [...current, applyLineSettings(newEdge, defaultLine)]
    })
    setLinkSource(null)
    setMenu(null)
  }, [setEdges, defaultLine])


  // ПКМ по заметке — открываем контекстное меню
  const onNodeContextMenu: NodeMouseHandler<NoteNode> =
    useCallback((event, node) => {
      event.preventDefault()
      setSelectedNoteId(node.id)

      setMenu({
        type: 'node',
        id: node.id,
        x: event.clientX,
        y: event.clientY,
      })
    }, [])

  // ПКМ по линии связи
  const onEdgeContextMenu: EdgeMouseHandler =
    useCallback((event, edge) => {
      event.preventDefault()

      setMenu({
        type: 'edge',
        id: edge.id,
        x: event.clientX,
        y: event.clientY,
      })
    }, [])

  // Начинаем создавать связь
  const startLinking = () => {
    if (!menu || menu.type !== 'node') return

    setLinkSource(menu.id)
    setMenu(null)
  }

  // Удаляем связь
  const deleteEdge = () => {
    if (!menu || menu.type !== 'edge') return

    setEdges((current) =>
      current.filter((edge) => edge.id !== menu.id)
    )

    setMenu(null)
  }

  // Открываем редактор
  const startEditing = () => {
    if (!menu || menu.type !== 'node') return

    const note = nodes.find((node) => node.id === menu.id)
    if (!note) return

    setDraftTitle(note.data.title)
    setDraftContent(note.data.content)
    setDraftHtml(note.data.richHtml ?? '')
    setDraftGallery(note.data.gallery || [])
    setDraftKind(note.data.kind || 'note')
    setGalleryError('')
    setEditingId(note.id)
    setPendingItemLinks([])
    setRemovedItemLinkIds([])
    setItemLinkDraft(null)
    setMenu(null)
  }

  // Сохраняем текст
  const saveEditing = () => {
    if (!editingId) return

    setNodes((current) =>
      current.map((node) =>
        node.id === editingId
          ? {
              ...node,
              data: {
                ...node.data,
                title: draftTitle.trim() || 'Без названия',
                content: draftContent,
                richHtml: draftHtml,
                kind: draftKind,
                gallery: draftGallery,
              },
            }
          : node
      )
    )

    // Only retain links whose source list item still exists in the saved HTML.
    // This also removes links to deleted list items and their descendants.
    const itemIds = new Set(Array.from(
      new DOMParser().parseFromString(draftHtml, 'text/html').querySelectorAll('li[data-item-id]')
    ).map(item => item.getAttribute('data-item-id')))
    setItemLinks(current => [
      ...current.filter(link => link.sourceNoteId !== editingId ||
        (itemIds.has(link.itemId) && !removedItemLinkIds.includes(link.id))),
      ...pendingItemLinks.filter(link => itemIds.has(link.itemId)),
    ])
    setPendingItemLinks([])
    setRemovedItemLinkIds([])
    setItemLinkDraft(null)
    setEditingId(null)
  }

  const updateSelectedLine = (patch: Partial<LineSettings>) => {
    if (!lineEditorId) return
    setEdges((current) => current.map((edge) => edge.id === lineEditorId
      ? applyLineSettings(edge, { ...lineSettings(edge), ...patch }) : edge))
  }
  // Переключение темы: остальные настройки применяются отдельным эффектом.
  const changeTheme = (next: ThemeId) => setThemeId(next)

  // Для связей с цветом темы обновляем цвет при смене темы.
  // Старые связи с одним из прежних стандартных цветов также переводим
  // на тематический цвет. Пользовательские нестандартные цвета не трогаем.
  useEffect(() => {
    const accent = THEMES.find((theme) => theme.id === themeId)?.accent ?? DEFAULT_LINE.color
    const palette = THEMES.map((theme) => theme.accent.toLowerCase())
    setEdges((current) => {
      let changed = false
      const updated = current.map((edge) => {
        const settings = lineSettings(edge)
        const legacyThemeColor = settings.themeColor === undefined && palette.includes(settings.color.toLowerCase())
        if (settings.themeColor !== true && !legacyThemeColor) return edge
        if (settings.color === accent && settings.themeColor === true && edge.style?.stroke === accent) return edge
        changed = true
        return applyLineSettings(edge, { ...settings, color: accent, themeColor: true })
      })
      return changed ? updated : current
    })
    setDefaultLine((current) => {
      const legacyThemeColor = current.themeColor === undefined && palette.includes(current.color.toLowerCase())
      if (current.themeColor !== true && !legacyThemeColor) return current
      if (current.color === accent && current.themeColor === true) return current
      return { ...current, color: accent, themeColor: true }
    })
  }, [themeId, setEdges])
  const editedLine = edges.find((edge) => edge.id === lineEditorId)
  const editedSettings = editedLine ? lineSettings(editedLine) : DEFAULT_LINE

  // Удаляем заметку и все её связи
  const deleteNote = () => {
    if (!menu || menu.type !== 'node') return

    const id = menu.id

    setNodes((current) =>
      current.filter((node) => node.id !== id)
    )

    setEdges((current) =>
      current.filter(
        (edge) =>
          edge.source !== id && edge.target !== id
      )
    )

    setItemLinks(current => current.filter(link => link.sourceNoteId !== id && link.targetNoteId !== id))
    if (linkSource === id) setLinkSource(null)
    if (selectedNoteId === id) setSelectedNoteId(null)

    setMenu(null)
  }

  // Возвращаем камеру к началу координат
  const goHome = () => {
    setViewport(
      { x: 0, y: 0, zoom: 1 },
      { duration: 500 }
    )

    setMenu(null)
    setLinkSource(null)
  }

  // Поиск работает по заголовку и содержимому, без учёта регистра.
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const searchResults = nodes
    .filter((node) =>
      !normalizedQuery ||
      node.data.title.toLocaleLowerCase().includes(normalizedQuery) ||
      node.data.content.toLocaleLowerCase().includes(normalizedQuery)
    )
    .sort((a, b) => a.data.title.localeCompare(b.data.title, 'ru'))

  // Ctrl+F открывает поиск; Escape закрывает его, не мешая редактору заметки.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        if (editingId !== null) return
        event.preventDefault()
        setSearchOpen(true)
        setMenu(null)
      } else if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchHighlightedId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingId, searchOpen])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // Списки строятся по направлению стрелок: source → target.
  const visibleItemLinks = itemLinks.filter(link => nodes.some(node => node.id === link.sourceNoteId) && nodes.some(node => node.id === link.targetNoteId))
  const selectedNote = nodes.find((node) => node.id === selectedNoteId)
  const outgoingNotes = selectedNote
    ? edges.filter((edge) => edge.source === selectedNote.id)
        .map((edge) => nodes.find((node) => node.id === edge.target))
        .filter((node): node is NoteNode => node !== undefined)
    : []
  const incomingNotes = selectedNote
    ? edges.filter((edge) => edge.target === selectedNote.id)
        .map((edge) => nodes.find((node) => node.id === edge.source))
        .filter((node): node is NoteNode => node !== undefined)
    : []

  // Камера плавно переходит к центру выбранной заметки.
  const focusNote = (id: string) => {
    const note = nodes.find((item) => item.id === id)
    if (!note) return
    setSelectedNoteId(id)
    setMenu(null)
    const width = note.measured?.width ?? 260
    const height = note.measured?.height ?? (note.data.collapsed ? 54 : 150)
    setCenter(note.position.x + width / 2, note.position.y + height / 2, {
      zoom: 1,
      duration: 650,
    })
  }

  const jumpToSearchResult = (id: string) => {
    focusNote(id)
    setSearchHighlightedId(id)
  }

  return (
    <div className="workspace" data-theme={themeId}>
      <ReactFlow
        edgeTypes={edgeTypes}
        nodes={nodes.map((node) => ({
          ...node,
          data: { ...node.data, onToggle: toggleNote,
            itemLinks: visibleItemLinks.filter(link => link.sourceNoteId === node.id).map(link => ({ itemId: link.itemId, targetId: link.targetNoteId, targetTitle: nodes.find(n => n.id === link.targetNoteId)?.data.title || 'Заметка' })),
            onFollowItemLink: focusNote },
          className: [node.className, searchHighlightedId === node.id ? 'note-search-highlight' : '']
            .filter(Boolean).join(' '),
        }))}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
       
        onConnectStart={(_, params) => {
          if (!params.nodeId) {
            dragOrigin.current = null
            return
          }

          dragOrigin.current = {
            nodeId: params.nodeId,
            handleType: params.handleType,
          }
        }}

        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => setMenu(null)}
        panOnDrag={[1]}
        selectionOnDrag={false}
        zoomOnScroll={true}
        minZoom={0.2}
        maxZoom={3}
        edgesFocusable={true}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        
      >
        <Background
          color="var(--grid-dot)"
          gap={24}
          size={1}
        />
      </ReactFlow>

      <button type="button" className="settings-toggle" onClick={() => { setSettingsOpen(true); setMenu(null) }} aria-label="Открыть настройки">
        ⚙ Настройки
      </button>

      <button type="button" className="help-toggle" onClick={() => { setHelpOpen(true); setMenu(null) }} aria-label="Открыть справку" title="Руководство пользователя">? Справка</button>

      {/* Поиск — только интерфейс; заметки и связи не меняются. */}
      <button
        type="button"
        className="search-toggle"
        onClick={() => {
          setSearchOpen((open) => !open)
          setSearchHighlightedId(null)
        }}
        aria-label={searchOpen ? 'Закрыть поиск' : 'Открыть поиск'}
        aria-expanded={searchOpen}
      >
        {searchOpen ? '✕ Закрыть поиск' : '⌕ Поиск'}
      </button>

      {searchOpen && (
        <aside className="search-panel" aria-label="Поиск по заметкам">
          <label htmlFor="note-search">Поиск по заметкам</label>
          <input
            id="note-search"
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setSearchHighlightedId(null)
            }}
            placeholder="Название или текст..."
          />
          <p className="search-status">
            {normalizedQuery ? 'Найдено' : 'Все заметки'}: {searchResults.length} из {nodes.length}
          </p>
          {searchResults.length === 0 && (
            <p className="search-status">
              {normalizedQuery ? 'Совпадений нет.' : 'Заметок пока нет.'}
            </p>
          )}
          <div className="search-results">
            {searchResults.map((note) => (
              <button
                key={note.id}
                type="button"
                className={`search-result${searchHighlightedId === note.id ? ' search-result-active' : ''}`}
                onClick={() => jumpToSearchResult(note.id)}
                title="Перейти к заметке"
              >
                <strong>{note.data.title}</strong>
                <span>{note.data.content.slice(0, 140) || 'Без содержимого'}</span>
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* Панель навигации не меняет положение заметок на холсте. */}
      <button
        type="button"
        className="navigation-toggle"
        onClick={() => setSidebarOpen((open) => !open)}
        aria-label={sidebarOpen ? 'Скрыть панель навигации' : 'Открыть панель навигации'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? 'Скрыть связи ❯' : 'Связи ❮'}
      </button>

      {sidebarOpen && (
        <aside className="navigation-panel" aria-label="Навигация по связям">
          <h2>Связанные заметки</h2>
          {!selectedNote ? (
            <p className="navigation-empty">Нажми на заметку, чтобы увидеть её связи.</p>
          ) : (
            <>
              <div className="navigation-current">
                <span>Выбрана заметка</span>
                <strong>{selectedNote.data.title}</strong>
              </div>
              <h3>Исходящие связи ({outgoingNotes.length})</h3>
              {outgoingNotes.length === 0 && <p className="navigation-empty">Нет исходящих связей</p>}
              {outgoingNotes.map((note) => (
                <button key={note.id} type="button" className="navigation-item"
                  onClick={() => focusNote(note.id)} title="Перейти к заметке">
                  <span>{note.data.title}</span><span aria-hidden="true">↗</span>
                </button>
              ))}
              <h3>Связи пунктов ({visibleItemLinks.filter(link => link.sourceNoteId === selectedNote.id).length})</h3>
              {visibleItemLinks.filter(link => link.sourceNoteId === selectedNote.id).map(link => (
                <button key={link.id} type="button" className="navigation-item"
                  onClick={() => focusNote(link.targetNoteId)} title="Перейти к связанной заметке">
                  <span>🔗 {link.itemLabel} → {nodes.find(n => n.id === link.targetNoteId)?.data.title}</span><span>↗</span>
                </button>
              ))}
              <h3>Ссылки на пункты этой заметки</h3>
              {visibleItemLinks.filter(link => link.targetNoteId === selectedNote.id).map(link => (
                <button key={link.id} type="button" className="navigation-item"
                  onClick={() => focusNote(link.sourceNoteId)}>
                  <span>{nodes.find(n => n.id === link.sourceNoteId)?.data.title} · {link.itemLabel}</span><span>↗</span>
                </button>
              ))}
              <h3>Входящие связи ({incomingNotes.length})</h3>
              {incomingNotes.length === 0 && <p className="navigation-empty">Нет входящих связей</p>}
              {incomingNotes.map((note) => (
                <button key={note.id} type="button" className="navigation-item"
                  onClick={() => focusNote(note.id)} title="Перейти к заметке">
                  <span>{note.data.title}</span><span aria-hidden="true">↗</span>
                </button>
              ))}
            </>
          )}
        </aside>
      )}

      {/* Основные кнопки */}
      <div className="toolbar">
        <button onClick={goHome} title="Домой">
          ⌂
        </button>

        <button onClick={addNote} title="Создать заметку">+</button>
        <button onClick={addGallery} title="Создать заметку-галерею">▦</button>
      </div>

      {/* Индикатор режима создания связи */}
      {linkSource && (
        <div className="link-banner">
          <span>
            Выбери заметку для создания связи
          </span>

          <button onClick={() => setLinkSource(null)}>
            Отмена
          </button>
        </div>
      )}

      {/* Контекстное меню */}
      {menu && (
        <div
          className="context-menu"
          style={{
            left: Math.max(
              0,
              Math.min(menu.x, window.innerWidth - 200)
            ),
            top: Math.max(
              0,
              Math.min(menu.y, window.innerHeight - 160)
            ),
          }}
        >
          {menu.type === 'node' ? (
            <>
              <button onClick={startEditing}>
                ✎ Редактировать
              </button>

              <button onClick={startLinking}>
                ↗ Создать связь
              </button>

              <button
                className="delete-action"
                onClick={deleteNote}
              >
                × Удалить заметку
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setLineEditorId(menu.id); setSettingsTab('connections'); setSettingsOpen(true); setMenu(null) }}>
                ⚙ Настроить связь
              </button>
              <button
              className="delete-action"
              onClick={deleteEdge}
            >
              × Удалить связь
            </button>
            </>
          )}
        </div>
      )}

      {helpOpen && (
        <div className="help-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setHelpOpen(false) }}>
          <section className="help-dialog" role="dialog" aria-modal="true" aria-label="Справка Infinite Notes">
            <header className="help-header">
              <div><span className="help-eyebrow">INFINITE NOTES · РУКОВОДСТВО</span><h2>Справка и возможности</h2></div>
              <button type="button" className="help-close" onClick={() => setHelpOpen(false)} aria-label="Закрыть справку">✕</button>
            </header>
            <div className="help-body">
              <nav className="help-nav" aria-label="Разделы справки">
                {([
                  ['start','Начало работы'], ['editor','Редактор'], ['links','Связи'],
                  ['images','Изображения'], ['backup','Резервные копии'],
                  ['controls','Управление'], ['about','О приложении'],
                ] as const).map(([id, label]) => <button key={id} type="button" className={helpSection === id ? 'active' : ''} onClick={() => setHelpSection(id)}>{label}</button>)}
              </nav>
              <div className="help-content">
                {helpSection === 'start' && <><h3>Начало работы</h3><p>Infinite Notes — бесконечный холст для заметок, идей и взаимосвязей.</p><ol><li>Нажми <strong>+</strong> в нижней панели, чтобы создать заметку.</li><li>Перемещай карточки по холсту мышью.</li><li>Щёлкни по заметке правой кнопкой мыши, чтобы открыть действия: редактирование, создание связи и удаление.</li><li>Используй «⌕ Поиск» для поиска по названию и тексту.</li><li>Кнопка «⌂» возвращает к обзору холста.</li></ol><p className="help-tip">Совет: сохраняй резервные копии перед крупными изменениями.</p></>}
                {helpSection === 'editor' && <><h3>Редактор заметок</h3><p>Открой контекстное меню заметки и выбери «Редактировать». В редакторе можно менять название, форматировать текст и создавать списки.</p><ul><li>Жирный, курсив, подчёркивание, зачёркивание, цвет текста и выделение доступны в панели инструментов.</li><li>Кнопки «→ Подпункт» и «← Уровень» меняют вложенность пунктов; также доступны Tab и Shift+Tab в списках.</li><li>Подпункты можно сворачивать и разворачивать.</li><li>Выдели текст для быстрого форматирования во всплывающей панели.</li><li>Кнопка «⛶ На весь экран» расширяет окно; «Свернуть» возвращает обычный размер.</li></ul><p className="help-tip">Не забудь нажать «Сохранить» после редактирования.</p></>}
                {helpSection === 'links' && <><h3>Связи между заметками</h3><p>Нажми правой кнопкой на заметку и выбери создание связи, затем укажи вторую заметку. Линии можно настроить в «⚙ Настройки → Связи».</p><p>Для связи конкретного пункта поставь курсор в пункт списка и нажми «🔗 Связать пункт» в редакторе. Выбери целевую заметку и сохрани изменения.</p><p>Нажатие на 🔗 рядом с пунктом показывает связанные заметки. В боковой панели «Связи» доступны переходы по связям.</p></>}
                {helpSection === 'images' && <><h3>Изображения и галереи</h3><p>В текстовом редакторе используй кнопку добавления изображения. Поддерживаются PNG, JPEG, WebP и GIF.</p><p>Для отдельной заметки-галереи нажми «▦» на нижней панели. В галерее можно добавлять изображения и подписи, открывать увеличенный просмотр и удалять элементы.</p><p>Изображения хранятся локально в IndexedDB этого приложения. Не очищай данные сайта или приложения без резервной копии.</p></>}
                {helpSection === 'backup' && <><h3>Резервные копии</h3><ol><li>Открой «⚙ Настройки → Резервные копии».</li><li>Нажми экспорт и сохрани ZIP в надёжном месте.</li><li>Для восстановления выбери ZIP и проверь предварительную информацию.</li><li>Подтверди импорт: текущие данные будут заменены содержимым архива.</li></ol><p className="help-tip">Перед импортом обязательно экспортируй текущий проект. Копия папки с исходным кодом не заменяет резервную копию заметок и изображений.</p></>}
                {helpSection === 'controls' && <><h3>Управление</h3><div className="help-shortcuts"><span>Ctrl + F</span><span>Открыть поиск (вне редактора)</span><span>Escape</span><span>Закрыть поиск</span><span>Колёсико мыши</span><span>Масштаб холста</span><span>Правая кнопка мыши</span><span>Контекстное меню заметки или связи</span><span>Tab / Shift + Tab</span><span>Уровень вложенности в списке</span></div><p>Перемещение холста и карточек выполняется мышью. Для точного управления связями используй контекстные меню.</p></>}
                {helpSection === 'about' && <><h3>О Infinite Notes</h3><p><strong>Infinite Notes</strong> — локальное приложение для организации заметок на бесконечном холсте.</p><p>Технологии: React, TypeScript, Vite, React Flow и Tiptap.</p><p>Заметки и настройки сохраняются в локальном хранилище приложения; изображения — в IndexedDB. Для переноса данных используй экспорт и импорт ZIP.</p><p>Текущий этап разработки: 16 — справка и документация. Публичный релиз и установщик запланированы на этап 17.</p></>}
              </div>
            </div>
          </section>
        </div>
      )}

      {(settingsOpen || (lineEditorId && editedLine)) && (
        <div className="settings-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) { setSettingsOpen(false); setLineEditorId(null) }
        }}>
          <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Настройки Infinite Notes">
            <div className="settings-header">
              <h2>⚙ Настройки</h2>
              <button type="button" onClick={() => { setSettingsOpen(false); setLineEditorId(null) }} aria-label="Закрыть настройки">✕</button>
            </div>
            <div className="settings-tabs">
              <button type="button" className={settingsTab === 'appearance' && !lineEditorId ? 'active' : ''} onClick={() => { setSettingsTab('appearance'); setLineEditorId(null) }}>Оформление</button>
              <button type="button" className={settingsTab === 'connections' || !!lineEditorId ? 'active' : ''} onClick={() => { setSettingsTab('connections'); setLineEditorId(null) }}>Связи</button>
              <button type="button" className={settingsTab === 'backup' && !lineEditorId ? 'active' : ''} onClick={() => { setSettingsTab('backup'); setLineEditorId(null) }}>Резервные копии</button>
            </div>
            {!lineEditorId && settingsTab === 'backup' ? (
              <section className="settings-section backup-section">
                <h3>Резервная копия проекта</h3>
                <p>Сохраните все заметки, связи, настройки и изображения в одном ZIP-файле. Архив можно перенести на другой компьютер и восстановить здесь.</p>
                <div className="backup-panel">
                  <h4>↓ Создать резервную копию</h4>
                  <p>Скачивается ZIP с заметками, связями пунктов, темой, настройками линий и изображениями из IndexedDB.</p>
                  <button type="button" className="backup-primary" disabled={backupBusy} onClick={async () => {
                    setBackupBusy(true); setBackupMessage('Подготавливаем резервную копию…')
                    try { downloadBackup(await exportBackup()); setBackupMessage('Архив подготовлен. Проверьте папку загрузок.') }
                    catch (error) { setBackupMessage(`Ошибка экспорта: ${error instanceof Error ? error.message : String(error)}`) }
                    finally { setBackupBusy(false) }
                  }}>Скачать ZIP проекта</button>
                </div>
                <div className="backup-panel">
                  <h4>↑ Восстановить проект</h4>
                  <p>Выберите ZIP, созданный Infinite Notes. Перед восстановлением проверьте его содержимое. Текущие заметки и настройки будут заменены.</p>
                  <input type="file" accept=".zip,application/zip" disabled={backupBusy} aria-label="Выбрать резервную копию ZIP" onChange={async event => {
                    const file = event.currentTarget.files?.[0] || null
                    setBackupFile(null); setBackupPreview(null); setBackupMessage('')
                    if (!file) return
                    setBackupBusy(true)
                    try { const preview = await inspectBackup(file); setBackupFile(file); setBackupPreview(preview) }
                    catch (error) { setBackupMessage(`Ошибка проверки: ${error instanceof Error ? error.message : String(error)}`) }
                    finally { setBackupBusy(false) }
                  }}/>
                  {backupPreview && <div className="backup-preview">
                    <strong>Архив проверен</strong>
                    <span>Создан: {new Date(backupPreview.date).toLocaleString('ru-RU')}</span>
                    <span>Заметок: {backupPreview.notes} · Линий: {backupPreview.edges} · Связей пунктов: {backupPreview.itemLinks} · Изображений: {backupPreview.images}</span>
                    <button type="button" className="backup-restore" disabled={backupBusy || !backupFile} onClick={async () => {
                      if (!backupFile || !window.confirm('Восстановить резервную копию? Текущие заметки, связи и настройки будут заменены. Сначала рекомендуется скачать резервную копию текущего проекта.')) return
                      setBackupBusy(true); setBackupMessage('Восстанавливаем данные…')
                      try { await importBackup(backupFile) }
                      catch (error) { setBackupMessage(`Ошибка восстановления: ${error instanceof Error ? error.message : String(error)}`); setBackupBusy(false) }
                    }}>Восстановить из ZIP</button>
                  </div>}
                </div>
                {backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}
                <p className="backup-note">Восстановление перезагрузит приложение. Архив не содержит исполняемые файлы программы.</p>
              </section>
            ) : !lineEditorId && settingsTab === 'appearance' ? (
              <section className="settings-section">
                <h3>Тема приложения</h3>
                <p>Тема меняет фон, карточки, панели и элементы управления. Градиент сохраняется.</p>
                <div className="theme-grid">
                  {THEMES.map((theme) => (
                    <button type="button" key={theme.id} className={`theme-choice${themeId === theme.id ? ' active' : ''}`} onClick={() => changeTheme(theme.id)} aria-pressed={themeId === theme.id}>
                      <span className="theme-preview" style={{ background: theme.preview }}><span style={{ background: theme.accent }} /></span>
                      <strong>{theme.label} {themeId === theme.id ? '✓' : ''}</strong>
                      <small>{theme.description}</small>
                    </button>
                  ))}
                </div>
                <button type="button" className="settings-reset" onClick={() => changeTheme('purple')}>Вернуть Infinite Purple</button>
              </section>
            ) : (
              <section className="settings-section">
                <h3>{lineEditorId ? 'Оформление выбранной связи' : 'Стиль новых связей'}</h3>
                <p>{lineEditorId ? 'Эти изменения затронут только выбранную связь.' : 'Эти параметры применяются к новым связям. Уже созданные связи не меняются.'}</p>
                {(() => {
                  const value = lineEditorId ? editedSettings : defaultLine
                  const update = (patch: Partial<LineSettings>) => {
                    if (lineEditorId) updateSelectedLine(patch)
                    else setDefaultLine((current) => ({ ...current, ...patch }))
                  }
                  return <div className="settings-fields">
                    <label>Форма линии
                      <select value={value.shape} onChange={(e) => update({ shape: e.target.value as LineShape })}>
                        <option value="straight">Прямая</option><option value="curve">Изогнутая</option>
                      </select>
                    </label>
                    <label>Стиль линии
                      <select value={value.pattern} onChange={(e) => update({ pattern: e.target.value as LinePattern })}>
                        <option value="solid">Сплошная</option><option value="dashed">Пунктирная</option><option value="dotted">Точечная</option>
                      </select>
                    </label>
                    <label>Цвет линии
                      <input type="color" value={value.color} onChange={(e) => update({ color: e.target.value, themeColor: false })} />
                    </label>
                    <label className="settings-checkbox"><input type="checkbox" checked={value.themeColor ?? false} onChange={(e) => update({ themeColor: e.target.checked, ...(e.target.checked ? { color: THEMES.find((t) => t.id === themeId)?.accent ?? DEFAULT_LINE.color } : {}) })} /> Цвет активной темы</label>
                    <label>Толщина: {value.width} px
                      <input type="range" min="1" max="8" step="0.5" value={value.width} onChange={(e) => update({ width: Number(e.target.value) })} />
                    </label>
                    <label className="settings-checkbox"><input type="checkbox" checked={value.arrow} onChange={(e) => update({ arrow: e.target.checked })} /> Показывать стрелку</label>
                    <div className="settings-line-preview" aria-label="Предпросмотр линии">
                      <svg viewBox="0 0 280 60" role="img">
                        <defs><marker id="settings-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill={value.color}/></marker></defs>
                        <path d={value.shape === 'curve' ? 'M 12 30 C 90 -5 190 65 268 30' : 'M 12 30 L 268 30'} fill="none" stroke={value.color} strokeWidth={value.width} strokeDasharray={value.pattern === 'dashed' ? '9 6' : value.pattern === 'dotted' ? '2 6' : undefined} strokeLinecap="round" markerEnd={value.arrow ? 'url(#settings-arrow)' : undefined}/>
                      </svg>
                    </div>
                    {lineEditorId && <button type="button" className="settings-reset" onClick={() => { setDefaultLine({ ...value }); setLineEditorId(null); setSettingsOpen(true); setSettingsTab('connections') }}>Сделать стилем по умолчанию</button>}
                    {!lineEditorId && <button type="button" className="settings-reset" onClick={() => setDefaultLine({ ...DEFAULT_LINE, color: THEMES.find((theme) => theme.id === themeId)?.accent ?? DEFAULT_LINE.color, themeColor: true })}>Сбросить настройки новых связей</button>}
                  </div>
                })()}
              </section>
            )}
          </div>
        </div>
      )}

      {/* Окно редактирования */}
      {editingId !== null && (
        <div className="editor-overlay">
          <div className={`editor-window editor-window-wide${editorFullscreen ? ' editor-window-fullscreen' : ''}`} role="dialog" aria-modal="true" aria-label="Редактирование заметки">
            <div className="editor-header">
              <div className="editor-heading"><span className="editor-heading-icon">✎</span><div><h2>Редактирование заметки</h2><span className="editor-heading-subtitle">{draftKind === 'gallery' ? 'Галерея изображений' : 'Текст, списки, изображения и связи'}</span></div></div>
              <button type="button" className="editor-expand-button" title={editorFullscreen ? 'Вернуть обычный размер' : 'Развернуть редактор'} aria-label={editorFullscreen ? 'Вернуть обычный размер' : 'Развернуть редактор'} aria-pressed={editorFullscreen} onClick={() => setEditorFullscreen(current => !current)}>{editorFullscreen ? '❐ Свернуть' : '⛶ На весь экран'}</button>
            </div>
            <div className="editor-scroll-area">
            <div className="editor-field-heading"><label htmlFor="note-title">Название</label></div>

            <input
              id="note-title"
              value={draftTitle}
              onChange={(event) =>
                setDraftTitle(event.target.value)
              }
              placeholder="Название заметки"
              autoFocus
            />

            <div className="editor-field-heading"><label htmlFor="note-content">Содержимое</label></div>

            {draftKind === 'gallery' ? <section className="gallery-editor">
              <label className="gallery-add">＋ Добавить изображения
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={async event => {
                  const files = Array.from(event.target.files || [])
                  event.target.value = ''
                  setGalleryError('')
                  for (const file of files) {
                    try { const id = await saveImage(file); setDraftGallery(current => [...current, { id, caption: '' }]) }
                    catch (error) { setGalleryError(error instanceof Error ? error.message : 'Ошибка загрузки') }
                  }
                }} />
              </label>
              {galleryError && <p className="image-error">{galleryError}</p>}
              <ImageGallery images={draftGallery} onChange={setDraftGallery} />
            </section> : <RichTextEditor
              key={editingId}
              initialHtml={draftHtml || ''}
              initialText={draftContent}
              onLinkItem={(itemId, itemLabel) => {
                setItemLinkDraft({ itemId, itemLabel })
                setItemLinkQuery('')
              }}
              onChange={(html, plain) => {
                setDraftHtml(html)
                setDraftContent(plain)
              }}
            />}

            {itemLinkDraft && <section className="item-link-picker">
              <div className="item-link-picker-heading">
                <strong>🔗 Связать пункт</strong>
                <button type="button" onClick={() => setItemLinkDraft(null)} aria-label="Закрыть выбор">×</button>
              </div>
              <p>Пункт: <strong>{itemLinkDraft.itemLabel}</strong></p>
              <input aria-label="Поиск целевой заметки" placeholder="⌕ Найти заметку..." value={itemLinkQuery}
                onChange={event => setItemLinkQuery(event.target.value)} />
              <div className="item-link-results">
                {nodes.filter(node => node.id !== editingId && node.data.title.toLowerCase().includes(itemLinkQuery.trim().toLowerCase())).sort((a,b) => a.data.title.localeCompare(b.data.title,'ru')).map(node => {
                  const linked = [...itemLinks.filter(link => !removedItemLinkIds.includes(link.id)), ...pendingItemLinks]
                    .some(link => link.sourceNoteId === editingId && link.itemId === itemLinkDraft.itemId && link.targetNoteId === node.id)
                  return <button key={node.id} type="button" disabled={linked} className="item-link-result" onClick={() => {
                    if (!editingId) return
                    setPendingItemLinks(current => [...current, { id: crypto.randomUUID(), sourceNoteId: editingId, itemId: itemLinkDraft.itemId, targetNoteId: node.id, itemLabel: itemLinkDraft.itemLabel }])
                    setItemLinkFeedback('Связь добавлена. Нажми «Сохранить», чтобы подтвердить.')
                    setItemLinkDraft(null)
                  }}><span>▤ {node.data.title}</span><span>{linked ? '✓ Связано' : '＋'}</span></button>
                })}
                {nodes.filter(node => node.id !== editingId && node.data.title.toLowerCase().includes(itemLinkQuery.trim().toLowerCase())).length === 0 && <p className="navigation-empty">Ничего не найдено</p>}
              </div>
              <button type="button" className="item-link-cancel" onClick={() => setItemLinkDraft(null)}>Отмена</button>
            </section>}
            {itemLinkFeedback && <p className="item-link-feedback">{itemLinkFeedback}</p>}
            {(itemLinks.some(link => link.sourceNoteId === editingId && !removedItemLinkIds.includes(link.id)) || pendingItemLinks.length > 0) && <section className="item-link-existing">
              <strong>Связи пунктов</strong>
              {[...itemLinks.filter(link => link.sourceNoteId === editingId && !removedItemLinkIds.includes(link.id)), ...pendingItemLinks].map(link => (
                <div key={link.id} className="item-link-existing-row">
                  <span>{link.itemLabel} → {nodes.find(node => node.id === link.targetNoteId)?.data.title || 'Удалённая заметка'}</span>
                  <button type="button" title="Удалить связь" onClick={() => {
                    setPendingItemLinks(current => current.filter(item => item.id !== link.id))
                    setRemovedItemLinkIds(current => [...current, link.id])
                  }}>×</button>
                </div>
              ))}
            </section>}
            </div>
            <div className="editor-actions">
              <span className="editor-footer-hint">Изменения применяются после сохранения</span>
              <button
                className="cancel-button"
                onClick={() => { setPendingItemLinks([]); setRemovedItemLinkIds([]); setItemLinkDraft(null); setEditingId(null) }}
              >
                Отмена
              </button>

              <button
                className="save-button"
                onClick={saveEditing}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  )
}
