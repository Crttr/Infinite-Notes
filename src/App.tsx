
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  SelectionMode,
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
import { saveImage, clearStoredImages, type GalleryImage } from './ImageStorage'
import { exportBackup, inspectBackup, importBackup, downloadBackup, type BackupPreview, BACKUP_KEYS } from './Backup'
import { ACTIVE_PROJECT_KEY, createProject, listProjects, putProject, removeProject, type LocalProject } from './ProjectStore'

// Tauri 2 exposes its command bridge when withGlobalTauri is enabled.
// Browser preview keeps the existing download-based export as a fallback.
type NativeBridge = { core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }
function nativeBridge(): NativeBridge | undefined {
  return (window as Window & { __TAURI__?: NativeBridge }).__TAURI__
}
const PROJECT_FILE_PATHS_KEY = 'infinite-notes-project-file-paths-v1'
function projectFilePath(id: string | null): string | null {
  if (!id) return null
  try {
    const paths = JSON.parse(localStorage.getItem(PROJECT_FILE_PATHS_KEY) || '{}') as Record<string, string>
    return typeof paths[id] === 'string' ? paths[id] : null
  } catch { return null }
}
function rememberProjectFilePath(id: string, path: string) {
  let paths: Record<string, string> = {}
  try { paths = JSON.parse(localStorage.getItem(PROJECT_FILE_PATHS_KEY) || '{}') as Record<string, string> } catch { /* reset invalid map */ }
  localStorage.setItem(PROJECT_FILE_PATHS_KEY, JSON.stringify({ ...paths, [id]: path }))
}

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
  | { type: 'pane'; x: number; y: number }
  | {
      type: 'edge'
      id: string
      x: number
      y: number
    }

function Workspace() {
  const canvasImageInputRef = useRef<HTMLInputElement>(null)
  const [canvasImageError, setCanvasImageError] = useState('')
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

  // Patch 09: canvas undo/redo. Snapshots omit transient React Flow callbacks.
  type CanvasSnapshot = { nodes: NoteNode[]; edges: Edge[]; links: ItemLink[] }
  const undoStack = useRef<CanvasSnapshot[]>([])
  const redoStack = useRef<CanvasSnapshot[]>([])
  const [historyStatus, setHistoryStatus] = useState({ undo: false, redo: false })
  const currentCanvas = useRef<CanvasSnapshot>({ nodes: [], edges: [], links: [] })
  const historyBusy = useRef(false)
  const snapshot = (): CanvasSnapshot => structuredClone(currentCanvas.current)
  const snapshotSignature = (value: CanvasSnapshot) => JSON.stringify(value)
  const rememberCanvas = () => {
    if (historyBusy.current) return
    const before = snapshot()
    if (snapshotSignature(undoStack.current.at(-1) ?? { nodes: [], edges: [], links: [] }) === snapshotSignature(before)) return
    undoStack.current.push(before)
    if (undoStack.current.length > 80) undoStack.current.shift()
    redoStack.current = []
    setHistoryStatus({ undo: true, redo: false })
  }
  const restoreCanvas = (value: CanvasSnapshot) => {
    historyBusy.current = true
    setNodes(value.nodes)
    setEdges(value.edges)
    setItemLinks(value.links)
    currentCanvas.current = structuredClone(value)
    setMenu(null)
    queueMicrotask(() => { historyBusy.current = false })
  }
  const undoCanvas = () => {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(snapshot())
    restoreCanvas(previous)
    setHistoryStatus({ undo: undoStack.current.length > 0, redo: true })
  }
  const redoCanvas = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(snapshot())
    restoreCanvas(next)
    setHistoryStatus({ undo: true, redo: redoStack.current.length > 0 })
  }
  const rememberDeletion = rememberCanvas
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [homeOpen, setHomeOpen] = useState(true)
  const [projectName, setProjectName] = useState(() => localStorage.getItem('infinite-notes-project-name') || 'Моё пространство')
  const [projects, setProjects] = useState<LocalProject[]>([])
  const [projectsReady, setProjectsReady] = useState(false)
  const projectOperationRef = useRef(false)
  const projectRevisionRef = useRef(0)
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectError, setProjectError] = useState('')
  const projectInputRef = useRef<HTMLInputElement>(null)
  const [renameTarget, setRenameTarget] = useState<LocalProject | null>(null)
  const [renameValue, setRenameValue] = useState('')

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
      style: node.style,
      data: {
        title: node.data.title,
        content: node.data.content,
        richHtml: node.data.richHtml,
        kind: node.data.kind,
        gallery: node.data.gallery,
        collapsed: node.data.collapsed ?? false,
        canvasImageId: node.data.canvasImageId,
        canvasImageWidth: node.data.canvasImageWidth,
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
  const addNote = useCallback((at?: { x: number; y: number }) => {
    const position = screenToFlowPosition(at ?? {
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

    rememberCanvas()
    setNodes((current) => [...current, newNote])
    setMenu(null)
  }, [screenToFlowPosition, setNodes])


  const addGallery = useCallback((at?: { x: number; y: number }) => {
    const position = screenToFlowPosition(at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 })
    rememberCanvas()
    setNodes(current => [...current, { id: crypto.randomUUID(), type: 'note', position,
      data: { title: 'Новая галерея', content: '', kind: 'gallery', gallery: [] } }])
  }, [screenToFlowPosition, setNodes])

  // Standalone reference image: stored as a Blob in the same IndexedDB as galleries.
  const addCanvasImages = async (files: FileList | null, at?: { x: number; y: number }) => {
    if (!files?.length) return
    setCanvasImageError('')
    const origin = screenToFlowPosition(at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const added: NoteNode[] = []
    for (const [index, file] of Array.from(files).entries()) {
      try {
        const id = await saveImage(file)
        added.push({ id: crypto.randomUUID(), type: 'note',
          position: { x: origin.x + index * 28, y: origin.y + index * 28 },
          data: { title: file.name, content: '', kind: 'canvasImage', canvasImageId: id, canvasImageWidth: 320 } })
      } catch (error) { setCanvasImageError(error instanceof Error ? error.message : 'Не удалось добавить изображение') }
    }
    if (added.length) { rememberCanvas(); setNodes(current => [...current, ...added]) }
    setMenu(null)
  }
  const resizeCanvasImage = useCallback((id: string, width: number) => {
    rememberCanvas()
    setNodes(current => current.map(node => node.id === id
      ? { ...node, data: { ...node.data, canvasImageWidth: Math.max(80, Math.min(1400, Math.round(width))) } }
      : node))
  }, [setNodes])

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
    rememberCanvas()

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
    rememberCanvas()

    setEdges((current) =>
      current.filter((edge) => edge.id !== menu.id)
    )

    setMenu(null)
  }

  // Открываем редактор
  const openNoteEditor = (id: string) => {
    const note = nodes.find((node) => node.id === id)
    if (!note || note.data.kind === 'canvasImage') return

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

  const startEditing = () => {
    if (menu?.type === 'node') openNoteEditor(menu.id)
  }

  // Сохраняем текст
  const saveEditing = () => {
    if (!editingId) return
    rememberCanvas()

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
    rememberCanvas()
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

  // Always use the latest committed canvas state for a history entry.
  currentCanvas.current = { nodes: structuredClone(nodes), edges: structuredClone(edges), links: structuredClone(itemLinks) }

  // Удаляем заметку и все её связи
  const deleteNote = () => {
    if (!menu || menu.type !== 'node') return

    const id = menu.id

    rememberDeletion()
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

  // v0.3 experimental: Delete removes selected canvas objects only outside text inputs and dialogs.
  // React Flow selection is authoritative; incident edges are removed with their notes.
  useEffect(() => {
    const removeSelection = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (editingId !== null || homeOpen || settingsOpen || helpOpen || renameTarget || projectBusy || backupBusy || lineEditorId || searchOpen) return
      const target = event.target
      if (target instanceof Element && (target.closest('input, textarea, select, button, [contenteditable], [role="dialog"]'))) return
      const selectedNodes = nodes.filter(node => node.selected).map(node => node.id)
      const selectedEdges = edges.filter(edge => edge.selected).map(edge => edge.id)
      if (!selectedNodes.length && !selectedEdges.length) return
      event.preventDefault()
      const ids = new Set(selectedNodes)
      const edgeIds = new Set(selectedEdges)
      rememberDeletion()
      setNodes(current => current.filter(node => !ids.has(node.id)))
      setEdges(current => current.filter(edge => !edgeIds.has(edge.id) && !ids.has(edge.source) && !ids.has(edge.target)))
      setItemLinks(current => current.filter(link => !ids.has(link.sourceNoteId) && !ids.has(link.targetNoteId)))
      setSelectedNoteId(current => current && ids.has(current) ? null : current)
      setMenu(null)
      setLinkSource(null)
    }
    window.addEventListener('keydown', removeSelection)
    return () => window.removeEventListener('keydown', removeSelection)
  }, [nodes, edges, editingId, homeOpen, settingsOpen, helpOpen, renameTarget, projectBusy, backupBusy, lineEditorId, searchOpen, setNodes, setEdges])

  useEffect(() => {
    const onHistoryKey = (event: KeyboardEvent) => {
      const z = event.code === 'KeyZ' || ['z', 'я'].includes(event.key.toLowerCase())
      if (!(event.ctrlKey || event.metaKey) || !z || event.altKey || event.repeat) return
      if (editingId !== null || homeOpen || settingsOpen || helpOpen || renameTarget || projectBusy || backupBusy || lineEditorId || searchOpen) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return
      if (event.shiftKey ? !redoStack.current.length : !undoStack.current.length) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.shiftKey) redoCanvas()
      else undoCanvas()
    }
    window.addEventListener('keydown', onHistoryKey, true)
    return () => window.removeEventListener('keydown', onHistoryKey, true)
  })

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

  // Keep a separate ZIP snapshot for each project; the active canvas uses legacy storage.
  const refreshProjects = async () => setProjects(await listProjects())
  useEffect(() => {
    let alive = true
    const initialize = async () => {
      try {
        const existing = await listProjects()
        let active = localStorage.getItem(ACTIVE_PROJECT_KEY)
        if (!existing.length) {
          // Migration: preserve the existing v0.1/v0.2 canvas as the first project.
          const first = createProject(localStorage.getItem('infinite-notes-project-name') || 'Моё пространство', await exportBackup())
          await putProject(first)
          active = first.id
          localStorage.setItem(ACTIVE_PROJECT_KEY, active)
        } else if (!active || !existing.some(project => project.id === active)) {
          // Never silently overwrite the old canvas with a different project.
          const recovered = createProject('Восстановленное пространство', await exportBackup())
          await putProject(recovered)
          active = recovered.id
          localStorage.setItem(ACTIVE_PROJECT_KEY, active)
        }
        const current = (await listProjects()).find(project => project.id === active)
        if (current) {
          localStorage.setItem('infinite-notes-project-name', current.name)
          if (alive) setProjectName(current.name)
        }
        if (alive) { await refreshProjects(); setProjectsReady(true) }
      } catch (error) { if (alive) setProjectError(`Не удалось открыть каталог проектов: ${String(error)}`) }
    }
    void initialize()
    return () => { alive = false }
  }, [])

  // A debounced snapshot follows the normal canvas autosave. Switching flushes it explicitly.
  useEffect(() => {
    if (!projectsReady || projectOperationRef.current) return
    const revision = ++projectRevisionRef.current
    const timer = window.setTimeout(async () => {
      if (projectOperationRef.current || revision !== projectRevisionRef.current) return
      try { await persistCurrentProject() }
      catch (error) { setProjectError(`Автосохранение проекта: ${String(error)}`) }
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [projectsReady, nodes, edges, itemLinks, themeId, defaultLine])

  const persistCurrentProject = async () => {
    const id = localStorage.getItem(ACTIVE_PROJECT_KEY)
    if (!id) return
    const existing = (await listProjects()).find(item => item.id === id)
    if (!existing) throw new Error('Активный проект отсутствует в каталоге')
    const blob = await exportBackup()
    await putProject({ ...existing, name: projectName, updatedAt: new Date().toISOString(), blob })
    await refreshProjects()
  }
  const withProjectOperation = async (task: () => Promise<void>) => {
    if (projectOperationRef.current) return
    projectOperationRef.current = true
    ++projectRevisionRef.current
    setProjectBusy(true)
    setProjectError('')
    try { await task() }
    catch (error) { setProjectError(error instanceof Error ? error.message : String(error)) }
    finally { projectOperationRef.current = false; setProjectBusy(false) }
  }
  const switchProject = async (target: LocalProject) => withProjectOperation(async () => {
    if (target.id === localStorage.getItem(ACTIVE_PROJECT_KEY)) { setHomeOpen(false); return }
    await persistCurrentProject()
    // Validate the target before touching the current canvas.
    if (target.blob) await inspectBackup(new File([target.blob], `${target.name}.inotes`))
    const previousId = localStorage.getItem(ACTIVE_PROJECT_KEY)
    localStorage.setItem(ACTIVE_PROJECT_KEY, target.id)
    localStorage.setItem('infinite-notes-project-name', target.name)
    try {
      if (target.blob) await importBackup(new File([target.blob], `${target.name}.inotes`), true)
      else {
        for (const key of BACKUP_KEYS) localStorage.removeItem(key)
        await clearStoredImages()
        window.location.reload()
      }
    } catch (error) {
      if (previousId) localStorage.setItem(ACTIVE_PROJECT_KEY, previousId)
      localStorage.setItem('infinite-notes-project-name', projectName)
      throw error
    }
  })
  const newProject = async () => {
    const name = window.prompt('Название нового проекта', 'Новый проект')?.trim()
    if (!name) return
    await withProjectOperation(async () => {
      await persistCurrentProject()
      const next = createProject(name)
      await putProject(next)
      localStorage.setItem(ACTIVE_PROJECT_KEY, next.id)
      localStorage.setItem('infinite-notes-project-name', next.name)
      for (const key of BACKUP_KEYS) localStorage.removeItem(key)
      await clearStoredImages()
      window.location.reload()
    })
  }
  // Save from the home screen and Ctrl+S always show the native Save dialog.
  const saveProjectFile = async (saveAs = false) => withProjectOperation(async () => {
    const bridge = nativeBridge()
    const id = localStorage.getItem(ACTIVE_PROJECT_KEY)
    if (!id) throw new Error('Сначала откройте проект')
    let path = saveAs ? null : projectFilePath(id)
    if (bridge && !path) {
      path = await bridge.core.invoke<string | null>('choose_inotes_save_path', { defaultName: projectName })
      if (!path) return // User cancelled; do not change the bound path.
    }
    await persistCurrentProject()
    const blob = await exportBackup()
    if (bridge && path) {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
      await bridge.core.invoke('write_inotes_file', { path, bytes })
      rememberProjectFilePath(id, path)
      setProjectError('Проект сохранён: ' + path)
    } else {
      // Vite/browser mode: preserve the previous export behavior.
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${projectName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'InfiniteNotes'}.inotes`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    }
  })
  const openNativeProjectFile = async () => {
    const bridge = nativeBridge()
    if (!bridge) { projectInputRef.current?.click(); return }
    try {
      const path = await bridge.core.invoke<string | null>('choose_inotes_open_path')
      if (!path) return
      const bytes = await bridge.core.invoke<number[]>('read_inotes_file', { path })
      const filename = path.split(/[\\/]/).pop() || 'Проект.inotes'
      const file = new File([new Uint8Array(bytes).buffer], filename, { type: 'application/zip' })
      // Import as a separate local project, then associate the source path only after success.
      await openProjectFile(file, path)
    } catch (error) { setProjectError(error instanceof Error ? error.message : String(error)) }
  }
  const openProjectFile = async (file?: File, nativePath?: string) => {
    if (!file) return
    await withProjectOperation(async () => {
      if (!/\.(inotes|zip)$/i.test(file.name)) throw new Error('Выберите файл .inotes или .zip')
      const info = await inspectBackup(file)
      const name = file.name.replace(/\.(inotes|zip)$/i, '')
      if (!window.confirm(`Добавить «${name}» в локальные проекты?\nЗаметок: ${info.notes}, изображений: ${info.images}.`)) return
      await persistCurrentProject()
      const next = createProject(name, file)
      await putProject(next)
      localStorage.setItem(ACTIVE_PROJECT_KEY, next.id)
      localStorage.setItem('infinite-notes-project-name', name)
      await importBackup(file, true)
      if (nativePath) rememberProjectFilePath(next.id, nativePath)
    })
  }
  useEffect(() => {
    const onSaveKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== 'KeyS') return
      if (editingId !== null || settingsOpen || renameTarget || projectBusy || backupBusy) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, [contenteditable], [role="dialog"]') && !homeOpen) return
      event.preventDefault()
      void saveProjectFile(true)
    }
    window.addEventListener('keydown', onSaveKey)
    return () => window.removeEventListener('keydown', onSaveKey)
  })
  const openRenameProject = (target?: LocalProject) => {
    const current = target || projects.find(project => project.id === localStorage.getItem(ACTIVE_PROJECT_KEY))
    if (!current) { setProjectError('Не удалось найти проект для переименования.'); return }
    setProjectError('')
    setRenameValue(current.name)
    setRenameTarget(current)
  }
  const renameProject = async () => {
    if (!renameTarget || projectOperationRef.current) return
    const name = renameValue.trim()
    if (!name) { setProjectError('Введите название проекта.'); return }
    const targetId = renameTarget.id
    await withProjectOperation(async () => {
      const current = (await listProjects()).find(project => project.id === targetId)
      if (!current) throw new Error('Проект больше не найден в каталоге')
      await putProject({ ...current, name, updatedAt: new Date().toISOString() })
      if (targetId === localStorage.getItem(ACTIVE_PROJECT_KEY)) {
        setProjectName(name)
        localStorage.setItem('infinite-notes-project-name', name)
      }
      await refreshProjects()
      setRenameTarget(null)
    })
  }
  const duplicateProject = async (target: LocalProject) => withProjectOperation(async () => {
    if (target.id === localStorage.getItem(ACTIVE_PROJECT_KEY)) await persistCurrentProject()
    const source = (await listProjects()).find(item => item.id === target.id)
    if (!source) throw new Error('Проект не найден')
    await putProject(createProject(`${source.name} — копия`, source.blob))
    await refreshProjects()
  })
  const deleteProject = async (target: LocalProject) => {
    if (target.id === localStorage.getItem(ACTIVE_PROJECT_KEY)) { setProjectError('Нельзя удалить открытый проект. Сначала переключитесь на другой.'); return }
    if (!window.confirm(`Удалить проект «${target.name}»? Это удалит его локальную копию. Для сохранения проекта сначала экспортируйте .inotes.`)) return
    await withProjectOperation(async () => { await removeProject(target.id); await refreshProjects() })
  }

  // Patch 07: React Flow resizes nodes; persist dimensions and update connection handles.
  const resizeNote = useCallback((id: string, width: number, height: number) => {
    setNodes(current => current.map(node => node.id === id
      ? { ...node, style: { ...node.style, width, height } }
      : node))
  }, [setNodes])

  // Patch 06: persist edits made directly on a gallery node on the canvas.
  const updateCanvasGallery = useCallback((id: string, gallery: GalleryImage[]) => {
    rememberCanvas()
    setNodes(current => current.map(node => node.id === id && node.data.kind === 'gallery'
      ? { ...node, data: { ...node.data, gallery } }
      : node))
  }, [setNodes])

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
            onFollowItemLink: focusNote, onResizeCanvasImage: resizeCanvasImage, onUpdateGallery: updateCanvasGallery, onResizeNote: resizeNote, onResizeStart: rememberCanvas },
          className: [node.className, searchHighlightedId === node.id ? 'note-search-highlight' : '']
            .filter(Boolean).join(' '),
        }))}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => rememberCanvas()}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={(_, node) => { if (!linkSource && node.data.kind !== 'canvasImage') openNoteEditor(node.id) }}
       
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
        onPaneContextMenu={(event) => { event.preventDefault(); setMenu({ type: 'pane', x: event.clientX, y: event.clientY }) }}
        panOnDrag={[1]}
        selectionOnDrag={true}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        panActivationKeyCode="Space"
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

      {!homeOpen && <div className="canvas-history-actions">
        <button type="button" disabled={!historyStatus.undo} onClick={undoCanvas} title="Отменить действие (Ctrl+Z)">↶ Отменить</button>
        <button type="button" disabled={!historyStatus.redo} onClick={redoCanvas} title="Повторить действие (Ctrl+Shift+Z)">↷ Повторить</button>
      </div>}
      <button type="button" className="project-home-toggle" onClick={() => { setHomeOpen(true); setMenu(null) }} title="Меню проектов">☰ Проекты</button>
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
              <div className="navigation-unified-title"><h3>Все связи</h3><span>{outgoingNotes.length + incomingNotes.length + visibleItemLinks.filter(link => link.sourceNoteId === selectedNote.id || link.targetNoteId === selectedNote.id).length}</span></div>
              {outgoingNotes.length + incomingNotes.length + visibleItemLinks.filter(link => link.sourceNoteId === selectedNote.id || link.targetNoteId === selectedNote.id).length === 0 && <p className="navigation-empty">У этой заметки пока нет связей.</p>}
              {outgoingNotes.map(note => <button key={`out-${note.id}`} type="button" className="navigation-item navigation-item-compact" onClick={() => focusNote(note.id)} title="Перейти к заметке"><span className="navigation-type-icon" title="Исходящая связь с заметкой">↗</span><span className="navigation-link-text"><strong>{note.data.title}</strong><small>Заметка · Исходящая</small></span><span>›</span></button>)}
              {incomingNotes.map(note => <button key={`in-${note.id}`} type="button" className="navigation-item navigation-item-compact" onClick={() => focusNote(note.id)} title="Перейти к заметке"><span className="navigation-type-icon" title="Входящая связь с заметкой">↙</span><span className="navigation-link-text"><strong>{note.data.title}</strong><small>Заметка · Входящая</small></span><span>›</span></button>)}
              {visibleItemLinks.filter(link => link.sourceNoteId === selectedNote.id || link.targetNoteId === selectedNote.id).map(link => {
                const outgoing = link.sourceNoteId === selectedNote.id
                const destination = nodes.find(node => node.id === (outgoing ? link.targetNoteId : link.sourceNoteId))
                return <button key={`item-${link.id}`} type="button" className="navigation-item navigation-item-compact" onClick={() => focusNote(outgoing ? link.targetNoteId : link.sourceNoteId)} title="Перейти к заметке"><span className="navigation-type-icon" title="Связь пункта">🔗</span><span className="navigation-link-text"><strong>{destination?.data.title || 'Заметка'}</strong><small>{outgoing ? 'Пункт → заметка' : 'Заметка → пункт'} · {link.itemLabel}</small></span><span>›</span></button>
              })}
            </>
          )}
        </aside>
      )}

      {/* Основные кнопки */}
      <div className="toolbar">
        <button onClick={goHome} title="Домой">
          ⌂
        </button>

        <button onClick={() => addNote()} title="Создать заметку">+</button>
        <button onClick={() => addGallery()} title="Создать заметку-галерею">▦</button>
        <button onClick={() => canvasImageInputRef.current?.click()} title="Добавить свободные изображения на холст">▧</button>
        <input ref={canvasImageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple
          style={{ display: 'none' }} onChange={event => { void addCanvasImages(event.target.files); event.target.value = '' }} />
      </div>

      {canvasImageError && <div className="canvas-image-error" role="alert" onClick={() => setCanvasImageError('')}>{canvasImageError} ×</div>}

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
          {menu.type === 'pane' ? (
            <>
              <button onClick={() => addNote({ x: menu.x, y: menu.y })}>＋ Создать заметку здесь</button>
              <button onClick={() => { addGallery({ x: menu.x, y: menu.y }); setMenu(null) }}>▦ Создать галерею здесь</button>
              <button onClick={() => { canvasImageInputRef.current?.click(); setMenu(null) }}>▧ Добавить изображение</button>
            </>
          ) : menu.type === 'node' ? (
            <>
              {nodes.find(node => node.id === menu.id)?.data.kind !== 'canvasImage' && <button onClick={startEditing}>
                ✎ Редактировать
              </button>}

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

      <input ref={projectInputRef} type="file" accept=".inotes,.zip,application/zip" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void openProjectFile(file) }} />
      {renameTarget && <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onMouseDown={event => { if (event.target === event.currentTarget && !projectBusy) setRenameTarget(null) }}>
        <form role="dialog" aria-modal="true" aria-label="Переименовать проект" onSubmit={event => { event.preventDefault(); void renameProject() }} style={{ width: 'min(440px, 100%)', padding: 24, borderRadius: 16, border: '1px solid var(--accent, #aa83bc)', background: 'var(--panel-bg, #33343d)', color: 'var(--text-color, #fff)', boxShadow: '0 20px 70px rgba(0,0,0,.5)', display: 'grid', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 21 }}>✎ Переименовать проект</h2>
          <label htmlFor="project-rename-input">Новое название</label>
          <input id="project-rename-input" autoFocus maxLength={120} value={renameValue} disabled={projectBusy} onChange={event => setRenameValue(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 9, border: '1px solid #8a8095', background: '#25252d', color: '#fff', fontSize: 15 }} />
          {projectError && <p role="alert" style={{ color: '#ffb2b2', margin: 0 }}>{projectError}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" disabled={projectBusy} onClick={() => { setRenameTarget(null); setProjectError('') }} style={{ padding: '10px 16px', borderRadius: 9, border: '1px solid #8a8095', background: '#454650', color: '#fff', cursor: 'pointer' }}>Отмена</button>
            <button type="submit" disabled={projectBusy || !renameValue.trim()} style={{ padding: '10px 16px', borderRadius: 9, border: '1px solid #b58bce', background: '#75518b', color: '#fff', cursor: 'pointer' }}>{projectBusy ? 'Сохраняем…' : 'Сохранить'}</button>
          </div>
        </form>
      </div>}
      {homeOpen && <div className="project-home-overlay" role="presentation">
        <section className="project-home-dialog" role="dialog" aria-modal="true" aria-label="Проекты Infinite Notes">
          <div className="project-home-brand"><span className="project-home-logo">∞</span><div><span className="project-home-kicker">INFINITE NOTES · v0.3.0</span><h1>Ваши идеи. Ваше пространство.</h1></div></div>
          <p className="project-home-intro">Локальные проекты сохраняются автоматически. Выбирайте пространство одним нажатием; файл .inotes нужен только для переноса и резервного копирования.</p>
          <div className="project-home-grid">
            <button type="button" disabled={projectBusy || !projectsReady} onClick={() => void newProject()}><strong>＋ Новый проект</strong><span>Создать отдельный пустой холст</span></button>
            <button type="button" disabled={projectBusy || !projectsReady} onClick={() => void openNativeProjectFile()}><strong>▤ Открыть .inotes</strong><span>Добавить .inotes или ZIP в список</span></button>
            <button type="button" disabled={projectBusy || !projectsReady} onClick={() => setHomeOpen(false)}><strong>↗ Продолжить</strong><span>{projectName}</span></button>
            <button type="button" disabled={projectBusy || !projectsReady} onClick={() => void saveProjectFile(true)}><strong>💾 Сохранить .inotes</strong><span>Сохранить копию на диск или флешку</span></button>
          </div>
          <div className="project-catalog-header"><h2>Мои проекты</h2><span>{projects.length} всего</span></div>
          <div className="project-catalog" role="list" aria-label="Сохранённые проекты">
            <div className="project-catalog-columns"><span>Проект</span><span>Создан</span><span>Изменён</span><span>Действия</span></div>
            {projects.map(project => <div className={`project-catalog-row ${project.id === localStorage.getItem(ACTIVE_PROJECT_KEY) ? 'current' : ''}`} key={project.id} role="listitem">
              <button type="button" className="project-catalog-open" disabled={projectBusy} onClick={() => void switchProject(project)} title="Открыть проект"><span className="project-catalog-icon">▤</span><span><strong>{project.name}</strong>{project.id === localStorage.getItem(ACTIVE_PROJECT_KEY) && <small>Открыт сейчас</small>}</span></button>
              <time title={project.createdAt}>{new Date(project.createdAt).toLocaleString('ru-RU')}</time>
              <time title={project.updatedAt}>{new Date(project.updatedAt).toLocaleString('ru-RU')}</time>
              <div className="project-catalog-actions">
                <button type="button" disabled={projectBusy} title="Переименовать" onClick={() => openRenameProject(project)}>✎</button>
                <button type="button" disabled={projectBusy} title="Создать копию" onClick={() => void duplicateProject(project)}>⧉</button>
                <button type="button" disabled={projectBusy || project.id === localStorage.getItem(ACTIVE_PROJECT_KEY)} title="Удалить проект" onClick={() => void deleteProject(project)}>×</button>
              </div>
            </div>)}
            {!projectsReady && <p className="project-catalog-loading">Загружаем каталог проектов…</p>}
          </div>
          {projectError && <p className="project-home-error" role="alert">{projectError}</p>}
          <div className="project-home-bottom"><button type="button" onClick={() => openRenameProject()}>✎ Переименовать</button><button type="button" onClick={() => { setHomeOpen(false); setSettingsOpen(true) }}>⚙ Настройки</button><button type="button" onClick={() => { setHomeOpen(false); setHelpOpen(true) }}>? Справка</button></div>
        </section>
      </div>}

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
                {helpSection === 'start' && <><h3>Начало работы</h3><p>Infinite Notes — бесконечный холст для заметок, галерей, отдельных изображений и связей между идеями.</p><ol><li>Создай проект или выбери существующий на экране «Проекты».</li><li>ПКМ по пустому холсту — создать заметку, галерею или добавить отдельное изображение.</li><li>Двойной ЛКМ по заметке — открыть редактор; перетаскивание заголовка — переместить заметку.</li><li>Выдели заметку и потяни за край или угол, чтобы изменить ширину и высоту.</li><li>Используй «Поиск» для поиска заметок, а «Проекты» — для переключения пространств.</li></ol><p className="help-tip">Локальные проекты сохраняются автоматически. Для отдельного файла на диске используй «Сохранить .inotes» или Ctrl + S.</p></>}
                {helpSection === 'editor' && <><h3>Редактор заметок</h3><p>Открой заметку двойным ЛКМ или через ПКМ → «Редактировать».</p><ul><li>Доступны жирный, курсив, подчёркивание, зачёркивание, цвет и выделение текста.</li><li>Tab в обычном абзаце вставляет отступ; в списке Tab делает вложенный пункт, Shift + Tab поднимает пункт на уровень выше.</li><li>Ctrl + Shift + 7 переключает нумерованный список; Ctrl + Shift + 8 — маркированный.</li><li>Tab из поля названия переводит фокус в текст заметки.</li><li>Подпункты списка можно сворачивать, а текст и изображения форматировать в редакторе.</li></ul><p className="help-tip">Внутри текстового редактора Ctrl + Z отменяет изменения текста; на холсте — действия с объектами.</p></>}
                {helpSection === 'links' && <><h3>Связи между заметками</h3><p>Через контекстное меню заметки можно создать связь с другой заметкой. Параметры линий настраиваются в «Настройки → Связи».</p><p>В редакторе можно связать отдельный пункт списка с заметкой; переходы доступны по значку связи рядом с пунктом и в панели «Связи».</p></>}
                {helpSection === 'images' && <><h3>Изображения и галереи</h3><p>ПКМ по пустому холсту → «Добавить изображение» создаёт самостоятельную картинку. Её можно выделить, передвинуть и изменить размер за угол с сохранением пропорций.</p><p>Галерея — свободная доска: изображения можно двигать прямо внутри карточки, изменять размер, накладывать друг на друга и менять порядок слоёв через ПКМ или меню ⋯. Команда «Упорядочить» раскладывает изображения автоматически.</p><p>Размер самой галереи меняется за границы и углы. Изображения также можно вставлять в текстовые заметки. Поддерживаются PNG, JPEG, WebP и GIF.</p><p className="help-tip">Изображения хранятся в IndexedDB приложения. Перед очисткой данных сделай резервную копию.</p></>}
                {helpSection === 'backup' && <><h3>Проекты и резервные копии</h3><p>Локальные проекты автоматически сохраняются внутри приложения. Для сохранения отдельного файла выбери «Сохранить .inotes» на экране проектов или нажми Ctrl + S: откроется окно выбора места и имени файла. Ctrl + S каждый раз показывает диалог сохранения.</p><p>Чтобы открыть ранее сохранённый проект, используй «Открыть .inotes». Для резервного ZIP открой «Настройки → Резервные копии», экспортируй архив и сохрани его в безопасном месте.</p><p className="help-tip">Автосохранение локального проекта не означает автоматическую перезапись файла .inotes на диске. После изменений сохраняй новый файл вручную.</p></>}
                {helpSection === 'controls' && <><h3>Горячие клавиши и мышь</h3><div className="help-shortcuts"><span>Ctrl + S</span><span>Открыть окно сохранения .inotes</span><span>Ctrl + Z</span><span>Отменить действие на холсте</span><span>Ctrl + Shift + Z</span><span>Повторить отменённое действие</span><span>Delete</span><span>Удалить выделенный объект (вне ввода текста)</span><span>Ctrl + F</span><span>Поиск заметок (вне редактора)</span><span>Tab / Shift + Tab</span><span>Отступ / уровень вложенности списка</span><span>Ctrl + Shift + 7</span><span>Нумерованный список в редакторе</span><span>Ctrl + Shift + 8</span><span>Маркированный список в редакторе</span><span>Двойной ЛКМ</span><span>Открыть заметку для редактирования</span><span>ПКМ</span><span>Контекстное меню холста, заметки или изображения</span><span>Пробел + перетаскивание</span><span>Переместить холст</span><span>Колёсико мыши</span><span>Масштаб холста</span><span>Escape</span><span>Закрыть поиск или снять выделение изображения</span></div><p>Выделенную заметку можно растягивать за края и углы. Галерея позволяет перемещать изображения без открытия редактора. История отмены/повтора хранится до закрытия приложения.</p></>}
                {helpSection === 'about' && <><h3>О Infinite Notes</h3><p><strong>Infinite Notes 0.3.0</strong> — локальное приложение для заметок и визуальных досок на бесконечном холсте под Windows.</p><p>В версии 0.3.0 появились свободные галереи и отдельные изображения, изменение размеров заметок, история Undo / Redo, сохранение .inotes через диалог выбора файла и улучшенный редактор списков.</p><p>Технологии: React, TypeScript, Vite, React Flow, Tiptap и Tauri 2. Локальные данные хранятся в приложении, изображения — в IndexedDB.</p></>}
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
              onKeyDown={(event) => {
                if (event.key !== 'Tab' || event.shiftKey) return
                const content = document.querySelector<HTMLElement>('.editor-window .rich-editor-area .ProseMirror')
                if (!content) return
                event.preventDefault()
                content.focus()
              }}
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
