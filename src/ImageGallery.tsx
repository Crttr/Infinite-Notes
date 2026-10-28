import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageUrl, type GalleryImage } from './ImageStorage'

function GalleryPhoto({ photo, onRemove, onCaption }: { photo: GalleryImage; onRemove?: () => void; onCaption?: (caption: string) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  useEffect(() => { let active = true; imageUrl(photo.id).then(url => { if (active) setSrc(url) }).catch(() => {}); return () => { active = false } }, [photo.id])
  return <div className="gallery-photo nodrag nopan">
    {src ? <button type="button" className="gallery-photo-open" onClick={() => setZoom(true)} title="Увеличить изображение"><img src={src} alt={photo.caption || 'Изображение'} /></button> : <div className="gallery-photo-missing">Изображение недоступно</div>}
    {onCaption ? <input value={photo.caption} onChange={e => onCaption(e.target.value)} placeholder="Подпись к изображению" aria-label="Подпись" /> : photo.caption && <p>{photo.caption}</p>}
    {onRemove && <button type="button" className="gallery-remove" onClick={onRemove}>Удалить</button>}
    {zoom && src && createPortal(<div className="gallery-lightbox" onClick={e => { e.stopPropagation(); setZoom(false) }} role="presentation"><button type="button" className="gallery-lightbox-close" onClick={() => setZoom(false)}>✕ Закрыть</button><img src={src} alt={photo.caption || 'Изображение'} onClick={e => e.stopPropagation()} /></div>, document.body)}
  </div>
}
export function ImageGallery({ images, onChange }: { images: GalleryImage[]; onChange?: (images: GalleryImage[]) => void }) {
  return <div className="image-gallery">
    {images.map((photo, index) => <GalleryPhoto key={photo.id} photo={photo}
      onRemove={onChange ? () => onChange(images.filter((_, i) => i !== index)) : undefined}
      onCaption={onChange ? caption => onChange(images.map((p, i) => i === index ? { ...p, caption } : p)) : undefined} />)}
    {!images.length && <div className="gallery-empty">В галерее пока нет изображений</div>}
  </div>
}
