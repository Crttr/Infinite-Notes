import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageRef, resolveImages } from './ImageStorage'

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
      if (source.tagName === 'SPAN') {
        const id = source.getAttribute('data-note-id')
        if (id && /^[a-f0-9-]{36}$/i.test(id)) {
          dest.setAttribute('data-note-id', id)
          if (source.getAttribute('data-link-style') === 'card') dest.setAttribute('data-link-style', 'card')
        }
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
      const target = event.target
      if (target instanceof Element) {
        const link = target.closest('[data-note-id]')
        const id = link?.getAttribute('data-note-id')
        if (id && /^[a-f0-9-]{36}$/i.test(id)) {
          event.preventDefault(); event.stopPropagation(); onFollow?.(id); return
        }
      }
      if (event.target instanceof HTMLImageElement && event.target.dataset.imageId) { event.stopPropagation(); setZoomSrc(event.target.src) }
    }} />
    {zoomSrc && createPortal(<div className="gallery-lightbox" onClick={event => { event.stopPropagation(); setZoomSrc(null) }}><button type="button" className="gallery-lightbox-close" onClick={() => setZoomSrc(null)}>✕ Закрыть</button><img src={zoomSrc} alt="Увеличенное изображение" /></div>, document.body)}
    {openItem && activeLinks.length > 0 && <div className="item-link-popover nodrag nopan" role="group" aria-label="Связанные заметки">
      <div className="item-link-popover-title"><strong>Связанные заметки ({activeLinks.length})</strong><button type="button" onClick={event => { event.stopPropagation(); setOpenItem(null) }} aria-label="Закрыть">×</button></div>
      {activeLinks.map(link => <button type="button" key={`${link.itemId}-${link.targetId}`} className="item-link-popover-entry" onClick={event => { event.stopPropagation(); setOpenItem(null); onFollow?.(link.targetId) }}>↗ {link.targetTitle}</button>)}
    </div>}
  </div>
}

