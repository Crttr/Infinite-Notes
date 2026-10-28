import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { createPortal } from 'react-dom'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { Extension, Node as TiptapNode } from '@tiptap/core'
import { saveImage, imageRef, imageUrl, resolveImages, canonicalImages, hydratedImages } from './ImageStorage'
import { Plugin } from '@tiptap/pm/state'

const EmbeddedImage = TiptapNode.create({
  name: 'embeddedImage', group: 'block', atom: true, draggable: true,
  addAttributes() { return {
    src: { default: null },
    imageId: { default: null, parseHTML: el => el.getAttribute('data-image-id'), renderHTML: attrs => attrs.imageId ? { 'data-image-id': attrs.imageId } : {} },
    width: { default: 320, parseHTML: el => Number(el.getAttribute('data-width')) || 320, renderHTML: attrs => ({ 'data-width': attrs.width }) },
  } },
  parseHTML() { return [{ tag: 'img[data-image-id]' }] },
  renderHTML({ HTMLAttributes }) { return ['img', { ...HTMLAttributes, style: `max-width:100%;width:${Math.min(900, Math.max(80, Number(HTMLAttributes.width) || 320))}px` }] },
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

const ALLOWED = new Set(['B','STRONG','I','EM','U','S','STRIKE','UL','OL','LI','DIV','P','BR','SPAN','FONT','IMG'])
const COLORS = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/
export function sanitizeRichText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const clean = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '')
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const source = node as HTMLElement
    if (['SCRIPT','STYLE','SVG','IFRAME','OBJECT','TEMPLATE'].includes(source.tagName)) return null
    const wrapper = document.createDocumentFragment()
    const allowed = ALLOWED.has(source.tagName)
    const dest = allowed ? document.createElement(source.tagName === 'FONT' ? 'span' : source.tagName.toLowerCase()) : wrapper
    if (allowed && dest instanceof HTMLElement) {
      if (source.tagName === 'IMG') {
        const id = source.getAttribute('data-image-id') || (source.getAttribute('src') || '').replace(/^infinite-image:/, '')
        if (!/^[a-f0-9-]{36}$/i.test(id)) return null
        dest.setAttribute('data-image-id', id)
        dest.setAttribute('src', imageRef(id))
        dest.setAttribute('data-width', String(Math.min(900, Math.max(80, Number(source.getAttribute('data-width')) || 320))))
        dest.style.width = `${Math.min(900, Math.max(80, Number(source.getAttribute('data-width')) || 320))}px`
      }
      if (source.tagName === 'LI') {
        const id = source.getAttribute('data-item-id')
        if (id && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) dest.setAttribute('data-item-id', id)
      }
      if (source.tagName === 'LI' && source.getAttribute('data-collapsed') === 'true') {
        dest.setAttribute('data-collapsed', 'true')
      }
      const color = source.tagName === 'FONT' ? source.getAttribute('color') : source.style.color
      if (color && COLORS.test(color)) dest.style.color = color
      const highlight = source.style.backgroundColor
      if (highlight && COLORS.test(highlight)) dest.style.backgroundColor = highlight
    }
    for (const child of Array.from(source.childNodes)) {
      const safe = clean(child)
      if (safe) dest.appendChild(safe)
    }
    return dest
  }
  const result = document.createElement('div')
  for (const child of Array.from(doc.body.childNodes)) {
    const safe = clean(child)
    if (safe) result.appendChild(safe)
  }
  return result.innerHTML
}

export function RichTextView({ html, links = [], onFollow }: { html: string; links?: { itemId: string; targetId: string; targetTitle: string }[]; onFollow?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.innerHTML = sanitizeRichText(html)
    void resolveImages(root)
    const grouped = new Map<string, typeof links>()
    for (const link of links) grouped.set(link.itemId, [...(grouped.get(link.itemId) || []), link])
    for (const [itemId, itemLinks] of grouped) {
      const item = Array.from(root.querySelectorAll('li[data-item-id]')).find(el => el.getAttribute('data-item-id') === itemId)
      if (!item) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'item-link-badge nodrag nopan'
      button.textContent = itemLinks.length > 1 ? `🔗 ${itemLinks.length}` : '🔗'
      button.title = itemLinks.length > 1 ? `${itemLinks.length} связанные заметки` : `Связано: ${itemLinks[0].targetTitle}`
      button.setAttribute('aria-label', `Показать связанные заметки (${itemLinks.length})`)
      button.onclick = event => { event.preventDefault(); event.stopPropagation(); setOpenItem(old => old === itemId ? null : itemId) }
      const anchor = Array.from(item.children).find(child => child.tagName === 'P') || item
      anchor.appendChild(button)
    }
  }, [html, links])
  const activeLinks = links.filter(link => link.itemId === openItem)
  return <div className="rich-text-linked-container">
    <div ref={ref} className="rich-text-view" onClick={event => {
      if (event.target instanceof HTMLImageElement && event.target.dataset.imageId) { event.stopPropagation(); setZoomSrc(event.target.src) }
    }} />
    {zoomSrc && createPortal(<div className="gallery-lightbox" onClick={event => { event.stopPropagation(); setZoomSrc(null) }}><button type="button" className="gallery-lightbox-close" onClick={() => setZoomSrc(null)}>✕ Закрыть</button><img src={zoomSrc} alt="Увеличенное изображение" /></div>, document.body)}
    {openItem && activeLinks.length > 0 && <div className="item-link-popover nodrag nopan" role="group" aria-label="Связанные заметки">
      <div className="item-link-popover-title"><strong>Связанные заметки ({activeLinks.length})</strong><button type="button" onClick={event => { event.stopPropagation(); setOpenItem(null) }} aria-label="Закрыть">×</button></div>
      {activeLinks.map(link => <button type="button" key={`${link.itemId}-${link.targetId}`} className="item-link-popover-entry" onClick={event => { event.stopPropagation(); setOpenItem(null); onFollow?.(link.targetId) }}>↗ {link.targetTitle}</button>)}
    </div>}
  </div>
}

type Props = { initialHtml: string; initialText: string; onChange: (html: string, plain: string) => void; onLinkItem?: (itemId: string, label: string) => void }
export function RichTextEditor({ initialHtml, initialText, onChange, onLinkItem }: Props) {
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const [revision, setRevision] = useState(0)
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const initialValues = useRef({ initialHtml, initialText })
  const [imageError, setImageError] = useState('')
  const [imageWidth, setImageWidth] = useState(320)
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
    extensions: [StarterKit, Underline, TextStyle, Color, Highlight.configure({ multicolor: true }), CollapsibleListItems, EmbeddedImage],
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
        if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return false
        const current = editorRef.current
        if (!current || !current.isActive('listItem')) return false
        const chain = current.chain().focus()
        const possible = event.shiftKey
          ? current.can().liftListItem('listItem')
          : current.can().sinkListItem('listItem')
        if (!possible) return false
        event.preventDefault()
        if (event.shiftKey) chain.liftListItem('listItem').run()
        else chain.sinkListItem('listItem').run()
        return true
      },
    },
    onUpdate: ({ editor: current }) => changeRef.current(sanitizeRichText(canonicalImages(current.getHTML())), current.getText({ blockSeparator: '\n' })),
    onSelectionUpdate: () => { setRevision(n => n + 1); requestAnimationFrame(updateFloating) },
    onBlur: () => setFloatingPosition(null),
    onTransaction: () => { setRevision(n => n + 1) },
  })
  editorRef.current = editor
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
  const updateImageWidth = (width: number) => {
    setImageWidth(width)
    if (selectedImage) editor.chain().focus().updateAttributes('embeddedImage', { width }).run()
  }
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
  const linkCurrentItem = () => {
    if (!currentListItem || listItemLevel === undefined || !onLinkItem) return
    const id = currentListItem.attrs.itemId as string | null
    if (!id) return
    const label = currentListItem.firstChild?.textContent?.trim() || 'Пункт без названия'
    onLinkItem(id, label)
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
    { label: '•', title: 'Маркированный список', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Нумерованный список', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
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
      <button type="button" title="Связать текущий пункт с другой заметкой" disabled={!currentListItem || !currentListItem.attrs.itemId || !onLinkItem}
        onMouseDown={event => event.preventDefault()} onClick={linkCurrentItem}>🔗 Связать пункт</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => fileRef.current?.click()}>🖼 Изображение</button>
      {selectedImage && <label>Ширина <input type="range" min="80" max="900" value={Number(editor.getAttributes('embeddedImage').width) || imageWidth} onChange={event => updateImageWidth(Number(event.target.value))} /></label>}
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
