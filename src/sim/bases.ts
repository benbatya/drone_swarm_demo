import { BASES } from './config'
import { distance, lngLatToMeters, type Vec2 } from './geo'

export interface BasePoint {
  id: string
  name: string
  pos: Vec2
}

export const BASE_POINTS: BasePoint[] = BASES.map((b) => ({
  id: b.id,
  name: b.name,
  pos: lngLatToMeters(b.lng, b.lat),
}))

export function baseById(id: string): BasePoint {
  const b = BASE_POINTS.find((p) => p.id === id)
  if (!b) throw new Error(`unknown base ${id}`)
  return b
}

export function nearestBase(p: Vec2): BasePoint {
  let best = BASE_POINTS[0]
  let bestD = Infinity
  for (const b of BASE_POINTS) {
    const d = distance(p, b.pos)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}
