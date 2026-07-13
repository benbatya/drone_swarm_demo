import type { Vec2 } from '../geo'

export interface MoveResult {
  pos: Vec2
  /** Compass bearing in radians (0 = north, clockwise). */
  heading: number
  arrived: boolean
}

/**
 * Move `from` toward `target` by at most `maxStep` meters. If within one step,
 * snaps to the target and reports arrival. Heading points along the motion
 * (unchanged when already at the target).
 */
export function moveToward(
  from: Vec2,
  target: Vec2,
  maxStep: number,
  prevHeading = 0,
): MoveResult {
  const dx = target.x - from.x
  const dy = target.y - from.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) {
    return { pos: { x: from.x, y: from.y }, heading: prevHeading, arrived: true }
  }
  const heading = Math.atan2(dx, dy) // bearing from north, clockwise
  if (dist <= maxStep) {
    return { pos: { x: target.x, y: target.y }, heading, arrived: true }
  }
  const t = maxStep / dist
  return {
    pos: { x: from.x + dx * t, y: from.y + dy * t },
    heading,
    arrived: false,
  }
}
