// Land mask for fire ignition: fires may only start on land, never in the
// Pacific Ocean (or other water outside the coastline). We reuse the same
// simplified Natural Earth land polygon the basemap renders, projected into the
// sim's local meters plane once at load, and test candidate points with a
// ray-casting point-in-polygon. Kept in the sim layer (the UI imports this
// data from here) so ignition stays free of any UI dependency.

import landData from './land.json'
import { lngLatToMeters, type Vec2 } from './geo'

type Ring = number[] // flat [x0,y0, x1,y1, ...] in meters
interface Poly {
  outer: Ring
  holes: Ring[]
}

function ringToMeters(coords: number[][]): Ring {
  const r: Ring = new Array(coords.length * 2)
  for (let i = 0; i < coords.length; i++) {
    const m = lngLatToMeters(coords[i][0], coords[i][1])
    r[i * 2] = m.x
    r[i * 2 + 1] = m.y
  }
  return r
}

function polygonToMeters(rings: number[][][]): Poly {
  // GeoJSON polygon: rings[0] = outer ring, rings[1..] = holes.
  return {
    outer: ringToMeters(rings[0]),
    holes: rings.slice(1).map(ringToMeters),
  }
}

function buildPolys(): Poly[] {
  const polys: Poly[] = []
  const features = (landData as { features: { geometry: { type: string; coordinates: unknown } }[] }).features
  for (const f of features) {
    const g = f.geometry
    if (g.type === 'Polygon') {
      polys.push(polygonToMeters(g.coordinates as number[][][]))
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][]) {
        polys.push(polygonToMeters(poly))
      }
    }
  }
  return polys
}

const POLYS: Poly[] = buildPolys()

/** Ray-cast: is (x,y) inside the flat ring [x0,y0,x1,y1,...]? */
function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]
    const yi = ring[i * 2 + 1]
    const xj = ring[j * 2]
    const yj = ring[j * 2 + 1]
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * True if the plane point falls on land (inside a land polygon and not in one
 * of its water holes). If the land polygon failed to load, fall back to `true`
 * so ignition is not silently disabled.
 */
export function isOnLand(p: Vec2): boolean {
  if (POLYS.length === 0) return true
  for (const poly of POLYS) {
    if (!inRing(p.x, p.y, poly.outer)) continue
    let inHole = false
    for (const hole of poly.holes) {
      if (inRing(p.x, p.y, hole)) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

/** Bisect toward the coastline between a known water and land sample; returns a
 * point on the LAND side, within ~1/256 of the initial gap of the true coast. */
function refineToCoast(at: (t: number) => Vec2, water: number, land: number): number {
  let w = water
  let l = land
  for (let i = 0; i < 8; i++) {
    const mid = (w + l) / 2
    if (isOnLand(at(mid))) l = mid
    else w = mid
  }
  return l
}

/**
 * Outer on-land extent along `axis` at the fixed cross-coordinate `across`,
 * searched within `[from, to]` (meters) by sampling every `step` meters and
 * refining the two coastline crossings by bisection. Returns `[lo, hi]` with
 * both endpoints on land (hugging the coast), or `null` if the whole span is
 * water. Used to clip a lawnmower leg to the land it should actually scan.
 *
 * Fails OPEN: if the land polygon failed to load, returns `[from, to]` so
 * scanning is not silently disabled. Takes the outer extent — a single span
 * from the first to the last on-land sample — so a bay in the middle of a row
 * is overflown rather than woven into (deliberate at this scale).
 */
export function landExtentAlongAxis(
  axis: 'x' | 'y',
  across: number,
  from: number,
  to: number,
  step: number,
): [number, number] | null {
  if (POLYS.length === 0) return [from, to]
  const at = (t: number): Vec2 => (axis === 'x' ? { x: t, y: across } : { x: across, y: t })

  // Sample positions across the span (inclusive of both ends).
  const ts: number[] = []
  for (let t = from; t < to; t += step) ts.push(t)
  ts.push(to)

  let firstIdx = -1
  let lastIdx = -1
  for (let i = 0; i < ts.length; i++) {
    if (isOnLand(at(ts[i]))) {
      if (firstIdx === -1) firstIdx = i
      lastIdx = i
    }
  }
  if (firstIdx === -1) return null // entirely water

  const lo = firstIdx > 0 ? refineToCoast(at, ts[firstIdx - 1], ts[firstIdx]) : ts[firstIdx]
  const hi =
    lastIdx < ts.length - 1 ? refineToCoast(at, ts[lastIdx + 1], ts[lastIdx]) : ts[lastIdx]
  return [lo, hi]
}
