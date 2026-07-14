import { describe, expect, it } from 'vitest'
import { BASES, WORLD_H_M, WORLD_W_M } from './config'
import {
  cellCenter,
  cellIdOf,
  clampToWorld,
  distance,
  lngLatToMeters,
  metersToLngLat,
} from './geo'

describe('clampToWorld', () => {
  it('clamps points into the world bounds', () => {
    expect(clampToWorld({ x: -500, y: -20 })).toEqual({ x: 0, y: 0 })
    expect(clampToWorld({ x: WORLD_W_M + 9999, y: WORLD_H_M + 9999 })).toEqual({
      x: WORLD_W_M,
      y: WORLD_H_M,
    })
    const inside = { x: 1000, y: 2000 }
    expect(clampToWorld(inside)).toEqual(inside)
  })
})

describe('geo projection', () => {
  it('round-trips lng/lat -> meters -> lng/lat within 10m', () => {
    for (const b of BASES) {
      const m = lngLatToMeters(b.lng, b.lat)
      const back = metersToLngLat(m.x, m.y)
      const err = distance(lngLatToMeters(back.lng, back.lat), m)
      expect(err).toBeLessThan(10)
    }
  })

  it('places the SW corner at the origin', () => {
    const m = lngLatToMeters(-124.5, 37.8)
    expect(Math.abs(m.x)).toBeLessThan(1e-6)
    expect(Math.abs(m.y)).toBeLessThan(1e-6)
  })

  it('measures a known distance (Redding <-> Sacramento) sanely', () => {
    const redding = lngLatToMeters(-122.39, 40.59)
    const sac = lngLatToMeters(-121.49, 38.58)
    const km = distance(redding, sac) / 1000
    // Great-circle is ~232 km; the flat plane should be within a few percent.
    expect(km).toBeGreaterThan(215)
    expect(km).toBeLessThan(245)
  })
})

describe('grid cell indexing', () => {
  it('recovers a cell center that maps back to the same cell', () => {
    const p = lngLatToMeters(-122.0, 40.0)
    const id = cellIdOf(p)
    const center = cellCenter(id)
    expect(cellIdOf(center)).toBe(id)
    // center is within one cell (10m) of the original point
    expect(distance(center, p)).toBeLessThan(CELL_DIAG)
  })
})

const CELL_DIAG = Math.hypot(10, 10)
