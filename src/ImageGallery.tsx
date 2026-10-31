import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageUrl, type GalleryImage } from './ImageStorage'

const DEFAULT_WIDTH = 180
const DEFAULT_HEIGHT = 420
const position = (photo: GalleryImage, index: number) => ({
  x: photo.x ?? 16 + (index % 3) * 195,
  y: photo.y ?? 16 + Math.floor(index / 3) * 190,
})

function Photo({ photo, selected, editable, onSelect, onMove, onResize, onRemove, onCaption, onFront, onBack, index, inlineMode }: {
  photo: GalleryImage; selected: boolean; editable: boolean; index: number; inlineMode: boolean
  onSelect: () => void; onMove: (x: number, y: number) => void; onResize: (width: number) => void
  onRemove: () => void; onCaption: (caption: string) => void; onFront: () => void; onBack: () => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [preview, setPreview] = useState<{ x?: number; y?: number; width?: number } | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const point = position(photo, index)
  useEffect(() => { let active = true; void imageUrl(photo.id).then(url => { if (active) setSrc(url) }).catch(() => { if (active) setSrc(null) }); return () => { active = false } }, [photo.id])
  useEffect(() => () => cleanup.current?.(), [])
  useEffect(() => { if (!selected) setMenuOpen(false) }, [selected])

  const startDrag = (event: React.PointerEvent<HTMLDivElement | HTMLSpanElement>, mode: 'move' | 'resize') => {
    if (!editable || event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    onSelect()
    cleanup.current?.()
    const originX = event.clientX; const originY = event.clientY
    const originalWidth = photo.width ?? DEFAULT_WIDTH
    const board = event.currentTarget.closest('.image-gallery') as HTMLElement | null
    const boardWidth = board?.clientWidth ?? 900
    const zoomScale = board?.getBoundingClientRect().width && board.clientWidth ? board.getBoundingClientRect().width / board.clientWidth : 1
    let latest = { x: point.x, y: point.y, width: originalWidth }
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - originX) / (zoomScale || 1)
      const dy = (e.clientY - originY) / (zoomScale || 1)
      if (mode === 'move') latest = { ...latest, x: Math.max(0, Math.round(point.x + dx)), y: Math.max(0, Math.round(point.y + dy)) }
      else latest = { ...latest, width: Math.max(100, Math.min(Math.max(120, boardWidth - point.x), Math.round(originalWidth + dx))) }
      setPreview(latest)
    }
    const finish = (e: PointerEvent) => {
      move(e)
      const result = latest
      cleanup.current?.()
      setPreview(null)
      if (mode === 'move') onMove(result.x, result.y)
      else onResize(result.width)
    }
    cleanup.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      cleanup.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  return <div className={`gallery-board-photo nodrag nopan ${selected ? 'gallery-board-photo-selected' : ''}`}
    style={{ left: preview?.x ?? point.x, top: preview?.y ?? point.y, width: preview?.width ?? photo.width ?? DEFAULT_WIDTH, zIndex: photo.z ?? index + 1 }}
    onPointerDown={event => { if (editable) { setMenuOpen(false); startDrag(event, 'move') } else onSelect() }}
    onContextMenu={event => { if (!editable) return; event.preventDefault(); event.stopPropagation(); onSelect(); setMenuOpen(true) }}>
    <div className="gallery-board-image" title={editable ? 'Перетащите изображение; двойной щелчок — просмотр' : 'Двойной щелчок — просмотр'}
      onDoubleClick={event => { if (!inlineMode) { event.stopPropagation(); setZoom(true) } }}>
      {src ? <img draggable={false} src={src} alt={photo.caption || 'Изображение'} /> : <span>Изображение недоступно</span>}
    </div>
    {editable && selected && <>
      <span className="gallery-board-resize" title="Изменить размер" onPointerDown={event => startDrag(event, 'resize')} />
      <div className="gallery-board-actions" onPointerDown={event => event.stopPropagation()}>
        <button type="button" title="Действия с изображением" aria-label="Действия с изображением" onClick={event => { event.stopPropagation(); setMenuOpen(open => !open) }}>⋯</button>
      </div>
      {menuOpen && <div className="gallery-layer-menu nodrag nopan" role="menu" onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
        <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); onFront(); setMenuOpen(false) }}>На передний план</button>
        <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); onBack(); setMenuOpen(false) }}>На задний план</button>
        <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); onRemove(); setMenuOpen(false) }}>Удалить изображение</button>
      </div>}
    </>}
    {editable && selected && !inlineMode && <input className="gallery-board-caption" value={photo.caption} placeholder="Подпись" aria-label="Подпись изображения" onPointerDown={event => event.stopPropagation()} onChange={event => onCaption(event.target.value)} />}
    {(!editable || inlineMode) && photo.caption && <span className="gallery-board-caption-label">{photo.caption}</span>}
    {zoom && src && createPortal(<div className="gallery-lightbox" role="presentation" onClick={() => setZoom(false)}><button type="button" className="gallery-lightbox-close" onClick={() => setZoom(false)}>✕ Закрыть</button><img src={src} alt={photo.caption || 'Изображение'} onClick={event => event.stopPropagation()} /></div>, document.body)}
  </div>
}

export function ImageGallery({ images, onChange, inlineMode = false }: { images: GalleryImage[]; onChange?: (images: GalleryImage[]) => void; inlineMode?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const editable = Boolean(onChange)
  const maxY = images.reduce((max, photo, index) => Math.max(max, position(photo, index).y + (photo.width ?? DEFAULT_WIDTH) * 1.15 + 40), DEFAULT_HEIGHT)
  const update = (id: string, values: Partial<GalleryImage>) => onChange?.(images.map(photo => photo.id === id ? { ...photo, ...values } : photo))
  const raise = (id: string, front: boolean) => {
    // Keep every image above the board background. Re-number layers instead
    // of assigning negative z-index values to images sent to the back.
    const ordered = [...images].sort((a, b) => {
      const aIndex = images.indexOf(a)
      const bIndex = images.indexOf(b)
      return (a.z ?? aIndex + 1) - (b.z ?? bIndex + 1) || aIndex - bIndex
    })
    const targetIndex = ordered.findIndex(photo => photo.id === id)
    if (targetIndex < 0) return
    const [target] = ordered.splice(targetIndex, 1)
    if (front) ordered.push(target)
    else ordered.unshift(target)
    const levels = new Map(ordered.map((photo, index) => [photo.id, index + 1]))
    onChange?.(images.map(photo => ({ ...photo, z: levels.get(photo.id)! })))
  }
  const arrange = () => {
    // Explicit layout command only: never silently reset manually positioned images.
    // Preserve image sizes and image order, but arrange in rows with padding.
    const board = boardRef.current
    const availableWidth = Math.max(320, board?.clientWidth ?? 640)
    const padding = 16
    const gap = 16
    let x = padding
    let y = padding
    let rowHeight = 0
    const ordered = [...images].sort((a, b) => (a.z ?? images.indexOf(a) + 1) - (b.z ?? images.indexOf(b) + 1))
    const placements = new Map<string, { x: number; y: number }>()
    for (const photo of ordered) {
      const width = Math.min(photo.width ?? DEFAULT_WIDTH, availableWidth - padding * 2)
      const height = width * 1.15 // Conservative spacing for images of unknown aspect ratio.
      if (x > padding && x + width > availableWidth - padding) { x = padding; y += rowHeight + gap; rowHeight = 0 }
      placements.set(photo.id, { x, y })
      x += width + gap
      rowHeight = Math.max(rowHeight, height)
    }
    onChange?.(images.map(photo => ({ ...photo, ...placements.get(photo.id) })))
    setSelectedId(null)
  }
  useEffect(() => {
    const clear = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.gallery-board-photo')) setSelectedId(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(null) }
    document.addEventListener('pointerdown', clear, true)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', clear, true); document.removeEventListener('keydown', escape, true) }
  }, [])
  return <div ref={boardRef} className={`image-gallery gallery-free-board ${editable ? 'gallery-free-board-editable' : 'gallery-free-board-preview'} ${inlineMode ? 'gallery-inline-mode' : ''}`} style={editable && !inlineMode ? { height: Math.min(2400, Math.ceil(maxY)) } : undefined}>
    {editable && images.length > 1 && <div className="gallery-board-toolbar nodrag nopan" onPointerDown={event => event.stopPropagation()}>
      <button type="button" title="Расставить изображения рядами (изменит их координаты)" onClick={event => { event.stopPropagation(); arrange() }}>Упорядочить</button>
    </div>}
    {images.map((photo, index) => <Photo key={photo.id} photo={photo} index={index} editable={editable} inlineMode={inlineMode} selected={selectedId === photo.id}
      onSelect={() => setSelectedId(photo.id)}
      onMove={(x, y) => { const levels = images.map((p, i) => p.z ?? i + 1); update(photo.id, { x, y, z: Math.max(0, ...levels) + 1 }) }}
      onResize={width => update(photo.id, { width })}
      onRemove={() => { onChange?.(images.filter(p => p.id !== photo.id)); setSelectedId(null) }}
      onCaption={caption => update(photo.id, { caption })}
      onFront={() => raise(photo.id, true)} onBack={() => raise(photo.id, false)} />)}
    {!images.length && <div className="gallery-empty">Добавьте изображения — затем перемещайте их в любом направлении</div>}
  </div>
}
