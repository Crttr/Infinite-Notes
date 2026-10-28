
import {
  BaseEdge,
  getStraightPath,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'


export function SmartEdge(props: EdgeProps) {
  // Вычисляем расстояние между точками подключения
  const distance = Math.hypot(
    props.targetX - props.sourceX,
    props.targetY - props.sourceY
  )

  // Чем дальше заметки, тем сильнее изгиб
  const curvature = Math.max(
    0.15,
    Math.min(0.4, distance / 900)
  )
  

  // Небольшое дополнительное расстояние между
  // контрольными точками кривой.
  // Не изменяет точки подключения заметок.
  const bendOffset = Math.min(
    25,
    distance * 0.08
  )

  const adjustedCurvature = Math.min(
    0.45,
    curvature + bendOffset / Math.max(distance, 1)
  )

  const settings = (props.data?.lineSettings ?? {}) as { shape?: string; pattern?: string }
  const [path] = settings.shape === 'straight' ? getStraightPath({
    sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY,
  }) : getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: adjustedCurvature,
  })

  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={{
        ...props.style,
        strokeDasharray: settings.pattern === 'dashed' ? '9 6' : settings.pattern === 'dotted' ? '2 6' : undefined,
        strokeLinecap: settings.pattern === 'dotted' ? 'round' : undefined,
      }}
    />
  )
}
