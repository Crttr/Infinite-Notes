
import { useEffect } from 'react'
import { RichTextView } from './RichText'
import { ImageGallery } from './ImageGallery'
import type { GalleryImage } from './ImageStorage'
import {
  useUpdateNodeInternals,
  Handle,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react'

export type NoteData = {
  title: string
  content: string
  richHtml?: string
  gallery?: GalleryImage[]
  kind?: 'note' | 'gallery'
  collapsed?: boolean
  onToggle?: (id: string) => void
  itemLinks?: { itemId: string; targetId: string; targetTitle: string }[]
  onFollowItemLink?: (id: string) => void
}

export type NoteNode = Node<NoteData, 'note'>

// Все четыре стороны подключения
const handles = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
]

export function NoteCard({
  id,
  data,
  selected,
}: NodeProps<NoteNode>) {
  const updateNodeInternals = useUpdateNodeInternals()

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, data.collapsed, updateNodeInternals])

  return (
    <div
      className={`note-card ${
        selected ? 'note-selected' : ''
      } ${data.collapsed ? 'note-collapsed' : ''
      }`}
    >
      {/* Входящие подключения */}
      {handles.map((handle) => (
        <Handle
          key={`target-${handle.id}`}
          id={`target-${handle.id}`}
          type="target"
          position={handle.position}
          className="note-handle note-handle-target"
          
            
            style={{
            width: 10,
            height: 10,
            background: '#c48bdf',
            border: '2px solid #ffffff',
            }}


        />
      ))}

      <div className="note-title">
        <span>{data.title}</span>
        <button
          type="button"
          className="note-collapse-button nodrag"
          aria-label={data.collapsed ? 'Развернуть заметку' : 'Свернуть заметку'}
          aria-expanded={!data.collapsed}
          onClick={(event) => {
            event.stopPropagation()
            data.onToggle?.(id)
          }}
        >
          {data.collapsed ? '▶' : '▼'}
        </button>
      </div>

      {!data.collapsed && (
        <div className="note-content">
          {data.kind === 'gallery' ? <ImageGallery images={data.gallery || []} /> : data.richHtml ? <RichTextView html={data.richHtml} links={data.itemLinks} onFollow={data.onFollowItemLink} /> : (data.content || 'ПКМ → Редактировать')}
        </div>
      )}

      {/* Исходящие подключения */}
      {handles.map((handle) => (
        <Handle
          key={`source-${handle.id}`}
          id={`source-${handle.id}`}
          type="source"
          position={handle.position}
          className="note-handle note-handle-source"
          
            
            style={{
            width: 10,
            height: 10,
            background: '#c48bdf',
            border: '2px solid #ffffff',
            }}


        />
      ))}
    </div>
  )
}
