// Fixed per-drone scan sectors. Each drone owns a standing rectangle it patrols
// (autoPatrol) — deterministic static assignment derived from the base layout,
// so both the sim and the (belief-isolated) User Console can compute it from the
// drone id alone, exactly like base positions.
//
// Latitude band: from the midpoint to the next base *south* (or the south
// border) up to the midpoint to the next base *north* (or the north border).
// Longitude: "-1" drones cover west-border → base; "-2" drones cover base →
// east-border. (Odd index → west half, even → east half, for robustness if
// dronesPerBase is ever > 2.)

import { BASES, BBOX } from '../config'
import type { RectM } from '../directives/types'
import { lngLatToMeters } from '../geo'

/** Parse `${baseId}-${n}` → { baseId, index }. */
export function parseDroneId(id: string): { baseId: string; index: number } | null {
  const m = /^(.*)-(\d+)$/.exec(id)
  if (!m) return null
  return { baseId: m[1], index: Number(m[2]) }
}

/** Latitude band [south, north] for a base: halfway to each neighbor, or border. */
function latBandFor(baseId: string): { south: number; north: number } | null {
  const sorted = [...BASES].sort((a, b) => a.lat - b.lat)
  const k = sorted.findIndex((b) => b.id === baseId)
  if (k < 0) return null
  const base = sorted[k]
  return {
    south: k > 0 ? (base.lat + sorted[k - 1].lat) / 2 : BBOX.south,
    north: k < sorted.length - 1 ? (base.lat + sorted[k + 1].lat) / 2 : BBOX.north,
  }
}

/** The fixed scan rectangle (plane meters) assigned to a drone, or null if unknown. */
export function scanSectorFor(id: string): RectM | null {
  const p = parseDroneId(id)
  if (!p) return null
  const base = BASES.find((b) => b.id === p.baseId)
  const band = base && latBandFor(base.id)
  if (!base || !band) return null

  const westSide = p.index % 2 === 1
  const lonWest = westSide ? BBOX.west : base.lng
  const lonEast = westSide ? base.lng : BBOX.east

  const min = lngLatToMeters(lonWest, band.south)
  const max = lngLatToMeters(lonEast, band.north)
  return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }
}
