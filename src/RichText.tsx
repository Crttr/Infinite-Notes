import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { Extension, Node as TiptapNode, Mark as TiptapMark } from '@tiptap/core'
import { saveImage, imageUrl, canonicalImages, hydratedImages } from './ImageStorage'
import { Plugin } from '@tiptap/pm/state'

// Links are stored in rich HTML using stable note IDs, not titles or URLs.
const InternalNoteLink = TiptapMark.create({
  name: 'internalNoteLink',
  inclusive: false,
  addAttributes() { return { styleMode: {
    default: 'inline',
    parseHTML: element => element.getAttribute('data-link-style') === 'card' ? 'card' : 'inline',
    renderHTML: attrs => attrs.styleMode === 'card' ? { 'data-link-style': 'card' } : {},
  }, noteId: {
    default: null,
    parseHTML: element => element.getAttribute('data-note-id'),
    renderHTML: attrs => attrs.noteId ? { 'data-note-id': attrs.noteId } : {},
  } } },
  parseHTML() { return [{ tag: 'span[data-note-id]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, class: 'inotes-internal-link' }, 0] },
})

const EmbeddedImage = TiptapNode.create({
  name: 'embeddedImage', group: 'block', atom: true, draggable: true,
  addAttributes() { return {
    src: { default: null },
    imageId: { default: null, parseHTML: el => el.getAttribute('data-image-id'), renderHTML: attrs => attrs.imageId ? { 'data-image-id': attrs.imageId } : {} },
    width: { default: 320, parseHTML: el => Number(el.getAttribute('data-width')) || 320, renderHTML: attrs => ({ 'data-width': attrs.width }) },
  } },
  parseHTML() { return [{ tag: 'img[data-image-id]' }] },
  renderHTML({ HTMLAttributes }) { return ['img', { ...HTMLAttributes, style: `max-width:100%;width:${Math.min(900, Math.max(80, Number(HTMLAttributes.width) || 320))}px` }] },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const outer = document.createElement('div')
      outer.className = 'inotes-image-node'
      outer.contentEditable = 'false'
      const img = document.createElement('img')
      img.draggable = false
      img.alt = 'Изображение в заметке'
      const handle = document.createElement('span')
      handle.className = 'inotes-image-resize'
      handle.title = 'Потяните для изменения размера'
      handle.setAttribute('role', 'button')
      handle.setAttribute('aria-label', 'Изменить размер изображения')
      outer.append(img, handle)
      const paint = (current: typeof node) => {
        img.src = String(current.attrs.src || '')
        img.dataset.imageId = String(current.attrs.imageId || '')
        outer.style.width = `${Math.min(900, Math.max(80, Number(current.attrs.width) || 320))}px`
      }
      paint(node)
      let cleanup: (() => void) | null = null
      outer.addEventListener('click', event => {
        event.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
      })
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        cleanup?.()
        const startX = event.clientX
        const initial = outer.getBoundingClientRect().width
        outer.classList.add('inotes-image-resizing')
        const move = (next: PointerEvent) => {
          const width = Math.max(80, Math.min(900, Math.round(initial + next.clientX - startX)))
          outer.style.width = `${width}px`
        }
        const finish = (next: PointerEvent) => {
          move(next)
          const width = Math.max(80, Math.min(900, Math.round(parseFloat(outer.style.width))))
          cleanup?.()
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (typeof pos !== 'number') return
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)?.attrs, width })
          editor.view.dispatch(tr)
        }
        cleanup = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          outer.classList.remove('inotes-image-resizing')
          cleanup = null
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
      })
      return {
        dom: outer,
        update: updated => { if (updated.type !== node.type) return false; paint(updated); return true },
        selectNode: () => outer.classList.add('inotes-image-selected'),
        deselectNode: () => outer.classList.remove('inotes-image-selected'),
        stopEvent: event => event.target === handle || (event.target instanceof Node && handle.contains(event.target)),
        ignoreMutation: () => true,
        destroy: () => cleanup?.(),
      }
    }
  },
})

// The collapsed flag is stored on list items, not in temporary React state.
const CollapsibleListItems = Extension.create({
  name: 'collapsibleListItems',
  addGlobalAttributes() {
    return [{
      types: ['listItem'],
      attributes: {
        itemId: {
          default: null,
          parseHTML: element => element.getAttribute('data-item-id'),
          renderHTML: attributes => attributes.itemId ? { 'data-item-id': attributes.itemId } : {},
        },
        collapsed: {
          default: false,
          parseHTML: element => element.getAttribute('data-collapsed') === 'true',
          renderHTML: attributes => attributes.collapsed ? { 'data-collapsed': 'true' } : {},
        },
      },
    }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (_transactions, _oldState, newState) => {
        const seen = new Set<string>()
        const updates: { pos: number; attrs: Record<string, unknown> }[] = []
        newState.doc.descendants((node, pos) => {
          if (node.type.name !== 'listItem') return
          const id = typeof node.attrs.itemId === 'string' ? node.attrs.itemId : ''
          if (!id || seen.has(id)) {
            updates.push({ pos, attrs: { ...node.attrs, itemId: crypto.randomUUID() } })
          } else {
            seen.add(id)
          }
        })
        if (!updates.length) return null
        const tr = newState.tr
        for (const { pos, attrs } of updates) tr.setNodeMarkup(pos, undefined, attrs)
        return tr
      },
    })]
  },
})

import { sanitizeRichText } from './RichTextView'

type Props = { targets?: { id: string; title: string }[]; initialHtml: string; initialText: string; onChange: (html: string, plain: string) => void }
export function RichTextEditor({ targets = [], initialHtml, initialText, onChange }: Props) {
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const [revision, setRevision] = useState(0)
  const [linkRange, setLinkRange] = useState<{ from: number; to: number } | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkEditing, setLinkEditing] = useState(false)
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const initialValues = useRef({ initialHtml, initialText })
  const [imageError, setImageError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let alive = true
    const { initialHtml: html, initialText: text } = initialValues.current
    const raw = html ? sanitizeRichText(html) : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('\n').map(line => `<p>${line || '<br>'}</p>`).join('')
    hydratedImages(raw).then(content => { if (alive) setInitialContent(content) }).catch(() => { if (alive) setInitialContent(raw) })
    return () => { alive = false }
  }, [])
  const [toolbarVisible, setToolbarVisible] = useState(() => localStorage.getItem('infinite-notes-toolbar-visible') !== 'false')
  const [floatingPosition, setFloatingPosition] = useState<{ top: number; left: number } | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const updateFloating = () => {
    const current = editorRef.current
    const container = editorContainerRef.current
    if (!current || !container || current.state.selection.empty || !current.isFocused) {
      setFloatingPosition(null)
      return
    }
    const { from, to } = current.state.selection
    const start = current.view.coordsAtPos(from)
    const end = current.view.coordsAtPos(to)
    const parent = container.getBoundingClientRect()
    const center = (start.left + end.right) / 2 - parent.left
    setFloatingPosition({ top: Math.max(0, Math.min(start.top, end.top) - parent.top - 48), left: Math.max(110, Math.min(container.clientWidth - 110, center)) })
  }
  useEffect(() => {
    const refresh = () => updateFloating()
    window.addEventListener('resize', refresh)
    document.addEventListener('scroll', refresh, true)
    return () => { window.removeEventListener('resize', refresh); document.removeEventListener('scroll', refresh, true) }
  })
  const editor = useEditor({
    extensions: [StarterKit, Underline, TextStyle, Color, Highlight.configure({ multicolor: true }), CollapsibleListItems, EmbeddedImage, InternalNoteLink],
    content: '',
    immediatelyRender: false,
    editorProps: {
      handleClick: (view, _pos, event) => {
        const target = event.target
        if (!(target instanceof Element)) return false
        const paragraph = target.closest('li > p:first-child')
        if (!(paragraph instanceof HTMLElement) || !view.dom.contains(paragraph)) return false
        const item = paragraph.parentElement
        if (!(item instanceof HTMLLIElement)) return false
        // Only the small arrow gutter is clickable; ordinary text editing is unaffected.
        const bounds = paragraph.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.left + 19 ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) return false
        const hasNestedList = Array.from(item.children).some(child => child.matches('ul, ol'))
        if (!hasNestedList) return false
        const $pos = view.state.doc.resolve(view.posAtDOM(paragraph, 0))
        let depth = $pos.depth
        while (depth > 0 && $pos.node(depth).type.name !== 'listItem') depth--
        if (!depth) return false
        const node = $pos.node(depth)
        const tr = view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
          ...node.attrs,
          collapsed: !node.attrs.collapsed,
        })
        view.dispatch(tr)
        event.preventDefault()
        return true
      },
      handleKeyDown: (_view, event) => {
        const current = editorRef.current
        if (!current || event.altKey || event.metaKey || event.isComposing) return false
        if (event.ctrlKey && event.shiftKey && (event.code === 'Digit7' || event.code === 'Digit8')) {
          event.preventDefault()
          if (event.code === 'Digit7') current.chain().focus().toggleOrderedList().run()
          else current.chain().focus().toggleBulletList().run()
          return true
        }
        if (event.ctrlKey) return false

        // Внутри списка Tab и Shift+Tab всегда остаются в редакторе.
        // Если вложенность уже максимальна/минимальна, фокус не прыгает на кнопки окна.
        if (event.key === 'Tab' && current.isActive('listItem')) {
          event.preventDefault()
          if (event.shiftKey) {
            if (current.can().liftListItem('listItem')) current.chain().focus().liftListItem('listItem').run()
          } else if (current.can().sinkListItem('listItem')) {
            current.chain().focus().sinkListItem('listItem').run()
          }
          return true
        }

        // В обычном абзаце Tab вставляет отступ, а не переводит фокус на панель.
        // Shift+Tab вне списка оставляем штатной навигации клавиатуры.
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault()
          current.chain().focus().insertContent('\u00a0\u00a0\u00a0\u00a0').run()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: current }) => changeRef.current(sanitizeRichText(canonicalImages(current.getHTML())), current.getText({ blockSeparator: '\n' })),
    onSelectionUpdate: () => { setRevision(n => n + 1); requestAnimationFrame(updateFloating) },
    onBlur: () => setFloatingPosition(null),
    onTransaction: () => { setRevision(n => n + 1) },
  })
  editorRef.current = editor
  useEffect(() => {
    if (!editor) return
    const clearImageSelection = (event: PointerEvent) => {
      if (!editor.isActive('embeddedImage')) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('.inotes-image-node')) return
      // Let ProseMirror handle clicks inside the editor itself.
      if (editor.view.dom.contains(target)) return
      const pos = editor.state.selection.from
      editor.commands.setTextSelection(pos)
    }
    const clearImageOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !editor.isActive('embeddedImage')) return
      editor.commands.setTextSelection(editor.state.selection.from)
    }
    document.addEventListener('pointerdown', clearImageSelection, true)
    document.addEventListener('keydown', clearImageOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', clearImageSelection, true)
      document.removeEventListener('keydown', clearImageOnEscape, true)
    }
  }, [editor])
  useEffect(() => {
    if (editor && initialContent !== null) editor.commands.setContent(initialContent, { emitUpdate: false })
  }, [editor, initialContent])
  const addEmbedded = async (file: File) => {
    if (!editor) return
    setImageError('')
    try {
      const id = await saveImage(file)
      const src = await imageUrl(id)
      if (!src) throw new Error('Не удалось загрузить изображение')
      editor.chain().focus().insertContent({ type: 'embeddedImage', attrs: { src, imageId: id, width: 320 } }).run()
    } catch (error) { setImageError(error instanceof Error ? error.message : 'Ошибка добавления изображения') }
  }
  if (!editor) return <div className="rich-editor-area">Загрузка редактора...</div>
  void revision
  const selectedImage = editor.isActive('embeddedImage')
  const inList = editor.isActive('listItem')
  const canIndent = inList && editor.can().sinkListItem('listItem')
  const canOutdent = inList && editor.can().liftListItem('listItem')
  // The current depth is derived from the actual document, not from the last clicked button.
  const { $from } = editor.state.selection
  let listDepth = 0
  for (let level = 0; level <= $from.depth; level++) {
    if ($from.node(level).type.name === 'listItem') listDepth++
  }
  const listItemLevel = Array.from({ length: $from.depth + 1 }, (_, i) => i).reverse().find(i => $from.node(i).type.name === 'listItem')
  const currentListItem = listItemLevel === undefined ? null : $from.node(listItemLevel)
  const hasChildren = !!currentListItem && Array.from({ length: currentListItem.childCount }, (_, i) => currentListItem.child(i)).some(node => node.type.name === 'bulletList' || node.type.name === 'orderedList')
  const isCollapsed = !!currentListItem?.attrs.collapsed
  const linkSelectedText = () => {
    const { from, to, empty } = editor.state.selection
    if (empty || from === to) return
    setLinkEditing(false)
    setLinkRange({ from, to })
    setLinkSearch('')
  }
  // Resolve a link even when the whole linked phrase is selected. ProseMirror
  // marks() at the end of a selection can refer to the NEXT text node.
  const getSelectedInternalLink = () => {
    const { from, to, empty } = editor.state.selection
    const type = editor.schema.marks.internalNoteLink
    if (!type) return null
    const matches: { from: number; to: number; noteId: string }[] = []
    const scanFrom = empty ? Math.max(0, from - 1) : from
    const scanTo = empty ? Math.min(editor.state.doc.content.size, to + 1) : to
    editor.state.doc.nodesBetween(scanFrom, scanTo, (node, pos) => {
      if (!node.isText) return
      const mark = node.marks.find(m => m.type === type)
      if (!mark) return
      const left = Math.max(pos, scanFrom)
      const right = Math.min(pos + node.nodeSize, scanTo)
      if (right > left) matches.push({ from: pos, to: pos + node.nodeSize, noteId: String(mark.attrs.noteId) })
    })
    if (!matches.length) return null
    const target = matches[0].noteId
    // Do not silently change one of several different links in a selection.
    if (matches.some(match => match.noteId !== target)) return null
    if (!empty && (matches[0].from > from || matches[matches.length - 1].to < to)) return null
    let linkFrom = Math.min(...matches.map(m => m.from))
    let linkTo = Math.max(...matches.map(m => m.to))
    // Expand to adjacent nodes sharing the same link mark.
    editor.state.doc.nodesBetween(Math.max(0, linkFrom - 1), Math.min(editor.state.doc.content.size, linkTo + 1), (node, pos) => {
      if (!node.isText || !node.marks.some(m => m.type === type && String(m.attrs.noteId) === target)) return
      if (pos + node.nodeSize === linkFrom) linkFrom = pos
      if (pos === linkTo) linkTo = pos + node.nodeSize
    })
    return { from: linkFrom, to: linkTo }
  }
  const editExistingTextLink = () => {
    const range = getSelectedInternalLink()
    if (!range) return
    setLinkEditing(true)
    setLinkRange(range)
    setLinkSearch('')
  }
  const applyTextLink = (noteId: string) => {
    if (!linkRange) return
    const { from, to } = linkRange
    if (to > editor.state.doc.content.size) { setLinkRange(null); return }
    const oldLink = editor.state.doc.resolve(from).marks().find(m => m.type === editor.schema.marks.internalNoteLink)
    const mark = editor.schema.marks.internalNoteLink.create({ noteId, styleMode: linkEditing && oldLink?.attrs.styleMode === 'card' ? 'card' : 'inline' })
    editor.view.dispatch(editor.state.tr.removeMark(from, to, editor.schema.marks.internalNoteLink).addMark(from, to, mark))
    setLinkRange(null)
    setLinkEditing(false)
  }
  const selectedLinkMode = () => {
    const range = getSelectedInternalLink()
    if (!range) return null
    let mode: string | null = null
    editor.state.doc.nodesBetween(range.from, range.to, node => {
      if (!node.isText) return
      const mark = node.marks.find(m => m.type === editor.schema.marks.internalNoteLink)
      if (mark && mode === null) mode = mark.attrs.styleMode === 'card' ? 'card' : 'inline'
    })
    return mode
  }
  const toggleLinkCard = () => {
    const range = getSelectedInternalLink()
    if (!range) return
    const { from, to } = range
    const type = editor.schema.marks.internalNoteLink
    const existing = editor.state.doc.resolve(from + 1).marks().find(m => m.type === type)
    if (!existing?.attrs.noteId) return
    const next = existing.attrs.styleMode === 'card' ? 'inline' : 'card'
    editor.view.dispatch(editor.state.tr.removeMark(from, to, type).addMark(from, to, type.create({ ...existing.attrs, styleMode: next })))
  }
  const toggleCollapse = () => {
    if (listItemLevel === undefined || !hasChildren) return
    const pos = $from.before(listItemLevel)
    editor.chain().focus().command(({ tr, dispatch }) => {
      if (dispatch) tr.setNodeMarkup(pos, undefined, { ...currentListItem.attrs, collapsed: !isCollapsed })
      return true
    }).run()
  }
  const isNested = listDepth > 1
  const isTopLevel = listDepth === 1
  const tools = [
    { label: 'Ж', title: 'Жирный', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'К', title: 'Курсив', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Ч', title: 'Подчёркивание', active: editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'З', title: 'Зачёркивание', active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { label: '•', title: 'Маркированный список (Ctrl+Shift+8)', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Нумерованный список (Ctrl+Shift+7)', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
  ]
  return <div className="rich-editor" ref={editorContainerRef}>
    <div className="rich-toolbar-toggle-row">
      <button type="button" className="rich-toolbar-toggle" onClick={() => setToolbarVisible(current => {
        localStorage.setItem('infinite-notes-toolbar-visible', String(!current))
        return !current
      })}>{toolbarVisible ? 'Скрыть панель форматирования' : 'Показать панель форматирования'}</button>
    </div>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => {
      const file = event.target.files?.[0]
      if (file) void addEmbedded(file)
      event.target.value = ''
    }} />
    {imageError && <p className="image-error" role="alert">{imageError}</p>}
    {linkRange && <section className="inotes-link-picker nodrag nopan" aria-label="Выбор целевой заметки">
      <div className="inotes-link-picker-header">
        <span className="inotes-link-picker-heading"><span aria-hidden="true">↗</span> {linkEditing ? 'Изменить цель ссылки' : 'Ссылка на заметку'}</span>
        <button type="button" className="inotes-link-picker-close" aria-label="Закрыть выбор заметки" onClick={() => setLinkRange(null)}>×</button>
      </div>
      <label className="inotes-link-picker-search">
        <span aria-hidden="true">⌕</span>
        <input autoFocus aria-label="Поиск заметки для ссылки" placeholder="Поиск по названию..." value={linkSearch} onChange={e => setLinkSearch(e.target.value)} />
      </label>
      {linkEditing && <p className="inotes-link-picker-hint">Выбери новую заметку — текст ссылки останется прежним.</p>}
      <div className="inotes-link-picker-caption">ДОСТУПНЫЕ ОБЪЕКТЫ <span>{targets.filter(t => t.title.toLocaleLowerCase().includes(linkSearch.trim().toLocaleLowerCase())).length}</span></div>
      <div className="inotes-link-picker-results" role="list" aria-label="Найденные заметки">
        {targets.filter(t => t.title.toLocaleLowerCase().includes(linkSearch.trim().toLocaleLowerCase())).map(t =>
          <button key={t.id} className="inotes-link-picker-result" type="button" onClick={() => applyTextLink(t.id)}>
            <span className="inotes-link-picker-result-icon" aria-hidden="true">▤</span>
            <span className="inotes-link-picker-result-title">{t.title || 'Без названия'}</span>
            <span className="inotes-link-picker-result-arrow" aria-hidden="true">↗</span>
          </button>)}
        {targets.every(t => !t.title.toLocaleLowerCase().includes(linkSearch.trim().toLocaleLowerCase())) &&
          <p className="inotes-link-picker-empty">Ничего не найдено. Попробуй другое название.</p>}
      </div>
    </section>}
    {toolbarVisible && <div className="rich-toolbar" aria-label="Форматирование текста">
      {tools.map(tool => <button key={tool.title} type="button" title={tool.title} aria-pressed={tool.active} className={tool.active ? 'rich-tool-active' : ''} onMouseDown={event => event.preventDefault()} onClick={tool.run}>{tool.label}</button>)}
      <button type="button" title="Сделать подпункт (Tab)" aria-label="Увеличить вложенность" aria-pressed={isNested} className={isNested ? 'rich-tool-active' : ''} disabled={!canIndent}
        onMouseDown={event => event.preventDefault()}
        onClick={() => editor.chain().focus().sinkListItem('listItem').run()}>→ Подпункт</button>
      <button type="button" title="Поднять пункт на уровень выше (Shift+Tab)" aria-label="Уменьшить вложенность" aria-pressed={isTopLevel} className={isTopLevel ? 'rich-tool-active' : ''} disabled={!canOutdent}
        onMouseDown={event => event.preventDefault()}
        onClick={() => editor.chain().focus().liftListItem('listItem').run()}>← Уровень</button>
      <button type="button" title="Скрыть или показать подпункты текущего пункта"
        aria-pressed={isCollapsed} className={isCollapsed ? 'rich-tool-active' : ''}
        disabled={!hasChildren} onMouseDown={event => event.preventDefault()}
        onClick={toggleCollapse}>{isCollapsed ? '▸ Развернуть' : '▾ Свернуть'}</button>
      <button type="button" title="Создать внутреннюю ссылку из выделенного текста" disabled={editor.state.selection.empty || targets.length === 0}
        onMouseDown={event => event.preventDefault()} onClick={linkSelectedText}>🔗 Связать текст</button>
      <button type="button" title="Изменить цель ссылки под курсором"
        disabled={!getSelectedInternalLink()}
        onMouseDown={event => event.preventDefault()} onClick={editExistingTextLink}>✎ Изменить ссылку</button>
      <button type="button" title="Переключить отображение ссылки: карточка или обычный текст"
        disabled={!getSelectedInternalLink()}
        onMouseDown={event => event.preventDefault()} onClick={toggleLinkCard}>{selectedLinkMode() === 'card' ? '↗ Обычная ссылка' : '▣ Ссылка-карточка'}</button>
      <button type="button" title="Удалить внутреннюю ссылку с выделенного текста" disabled={!editor.isActive('internalNoteLink')}
        onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().unsetMark('internalNoteLink').run()}>Убрать ссылку</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => fileRef.current?.click()}>🖼 Изображение</button>
      {selectedImage && <button type="button" onClick={() => editor.chain().focus().deleteSelection().run()}>Удалить изображение</button>}
      <label>Текст <input type="color" defaultValue="#ffffff" title="Цвет букв" onChange={event => editor.chain().focus().setColor(event.currentTarget.value).run()} /></label>
      <label>Выделение <input type="color" defaultValue="#ffe16b" title="Цвет фона текста" onChange={event => editor.chain().focus().setHighlight({ color: event.currentTarget.value }).run()} /></label>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().unsetAllMarks().run()}>Очистить стиль</button>
    </div>}
    {floatingPosition && <div className="rich-floating-toolbar" style={{ top: floatingPosition.top, left: floatingPosition.left }} role="toolbar" aria-label="Быстрое форматирование выделения">
      {tools.slice(0, 4).map(tool => <button key={tool.title} type="button" title={tool.title} aria-pressed={tool.active} className={tool.active ? 'rich-tool-active' : ''} onMouseDown={event => event.preventDefault()} onClick={tool.run}>{tool.label}</button>)}
      <label title="Цвет текста">А <input type="color" defaultValue="#ffffff" onChange={event => editor.chain().focus().setColor(event.currentTarget.value).run()} /></label>
      <label title="Выделение цветом">▨ <input type="color" defaultValue="#ffe16b" onChange={event => editor.chain().focus().setHighlight({ color: event.currentTarget.value }).run()} /></label>
    </div>}
    <EditorContent editor={editor} className="rich-editor-area" />
  </div>
}
