import { useLayoutEffect, useRef, useState } from 'react'
import { BaseEdge, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'

/**
 * Internal links are display-only edges. Their start point follows the actual
 * link badge/text in the rendered note, rather than the note's outer handle.
 * The endpoint stays on the target note handle (existing settings).
 * Collapsed or virtualized source notes fall back to their original handle.
 */
export function CardAnchoredEdge({
  id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, sourceHandleId, style,
}: EdgeProps) {
  const { getZoom } = useReactFlow()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const last = useRef({ x: 0, y: 0 })

  useLayoutEffect(() => {
    const sourceNode = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]'))
      .find(element => element.dataset.id === source)
    if (!sourceNode) return
    let frame = 0
    const measure = () => {
      frame = 0
      const sourceHandle = Array.from(sourceNode.querySelectorAll<HTMLElement>('.react-flow__handle'))
        .find(element => element.dataset.handleid === sourceHandleId)
      const link = Array.from(sourceNode.querySelectorAll<HTMLElement>('.rich-text-view [data-note-id]'))
        .find(element => element.dataset.noteId === target)
      const zoom = getZoom() || 1
      let x = 0
      let y = 0
      if (sourceHandle && link && link.getClientRects().length) {
        const handleRect = sourceHandle.getBoundingClientRect()
        const linkRect = link.getBoundingClientRect()
        // Attach at the requested side of the *link*, not the source note.
        const side = sourceHandleId?.replace('source-', '') || 'right'
        const px = side === 'left' ? linkRect.left : side === 'right' ? linkRect.right : linkRect.left + linkRect.width / 2
        const py = side === 'top' ? linkRect.top : side === 'bottom' ? linkRect.bottom : linkRect.top + linkRect.height / 2
        x = (px - (handleRect.left + handleRect.width / 2)) / zoom
        y = (py - (handleRect.top + handleRect.height / 2)) / zoom
      }
      if (Math.abs(last.current.x - x) > .25 || Math.abs(last.current.y - y) > .25) {
        last.current = { x, y }
        setOffset({ x, y })
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(sourceNode)
    const content = sourceNode.querySelector('.rich-text-view')
    if (content) resize.observe(content)
    const changes = new MutationObserver(schedule)
    changes.observe(sourceNode, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-note-id', 'data-link-style'] })
    sourceNode.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      changes.disconnect()
      sourceNode.removeEventListener('scroll', schedule, true)
    }
  }, [source, target, sourceHandleId, getZoom])

  const [path] = getBezierPath({
    sourceX: sourceX + offset.x,
    sourceY: sourceY + offset.y,
    targetX, targetY, sourcePosition, targetPosition,
  })
  return <BaseEdge id={id} path={path} style={style} />
}
