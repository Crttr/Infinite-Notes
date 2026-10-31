import { useEffect, useState, type PointerEvent } from 'react'
import { imageUrl } from './ImageStorage'

type Props = {
  imageId?: string
  width: number
  selected: boolean
  onResize?: (width: number) => void
}

export function CanvasReference({ imageId, width, selected, onResize }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    setSrc(null)
    setError(false)
    if (!imageId) { setError(true); return }
    imageUrl(imageId).then(url => {
      if (!active) return
      if (url) setSrc(url)
      else setError(true)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [imageId])

  function beginResize(event: PointerEvent<HTMLSpanElement>) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = width
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const move = (e: globalThis.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // React Flow zoom scales pointer movement; compute zoom from rendered element.
      const parent = element.closest('.react-flow__node') as HTMLElement | null
      const renderedWidth = parent?.getBoundingClientRect().width || width
      const scale = Math.max(0.1, renderedWidth / Math.max(1, startWidth))
      onResize?.(Math.max(80, Math.min(1400, Math.round(startWidth + (e.clientX - startX) / scale))))
    }
    const finish = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', finish)
      element.removeEventListener('pointercancel', finish)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', finish)
    element.addEventListener('pointercancel', finish)
  }

  return <div className={`canvas-reference${selected ? ' canvas-reference-selected' : ''}`} style={{ width }}>
    {src ? <img src={src} alt="Изображение на холсте" draggable={false} /> :
      <div className="canvas-reference-missing">{error ? 'Изображение не найдено' : 'Загрузка изображения…'}</div>}
    {selected && <><span className="canvas-reference-size">{width} px</span>
      <span className="canvas-reference-handle nodrag nopan" role="slider" aria-label="Изменить ширину изображения" onPointerDown={beginResize} /></>}
  </div>
}
