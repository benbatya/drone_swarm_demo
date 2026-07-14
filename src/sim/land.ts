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
