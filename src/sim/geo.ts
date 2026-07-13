// Local equirectangular meters plane <-> lng/lat, plus grid cell indexing.
// All simulation math runs in flat 2D meters (origin = SW corner of BBOX);
// only rendering converts back to lng/lat. Distortion is <~2.7% and
// self-consistent, which is fine for a demo.

import {
  BBOX,
  CELL_SIZE_M,
  COS_REF_LAT,
  GRID_COLS,
  M_PER_DEG,
} from './config'

export interface Vec2 {
  x: number
  y: number
}

export interface LngLat {
  lng: number
  lat: number
}

const M_PER_DEG_LON = M_PER_DEG * COS_REF_LAT

/** Project lng/lat -> local meters (x east, y north; origin SW corner). */
export function lngLatToMeters(lng: number, lat: number): Vec2 {
  return {
    x: (lng - BBOX.west) * M_PER_DEG_LON,
    y: (lat - BBOX.south) * M_PER_DEG,
  }
}

/** Inverse of {@link lngLatToMeters}. */
export function metersToLngLat(x: number, y: number): LngLat {
  return {
    lng: BBOX.west + x / M_PER_DEG_LON,
    lat: BBOX.south + y / M_PER_DEG,
  }
}

/** Euclidean distance in meters between two plane points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export type CellId = number

/** Grid column/row containing a plane point. */
export function cellOf(p: Vec2): { cx: number; cy: number } {
  return { cx: Math.floor(p.x / CELL_SIZE_M), cy: Math.floor(p.y / CELL_SIZE_M) }
}

export function toCellId(cx: number, cy: number): CellId {
  return cy * GRID_COLS + cx
}

export function cellIdOf(p: Vec2): CellId {
  const { cx, cy } = cellOf(p)
  return toCellId(cx, cy)
}

export function cellColRow(id: CellId): { cx: number; cy: number } {
  return { cx: id % GRID_COLS, cy: Math.floor(id / GRID_COLS) }
}

/** Center of a cell in plane meters. */
export function cellCenter(id: CellId): Vec2 {
  const { cx, cy } = cellColRow(id)
  return { x: (cx + 0.5) * CELL_SIZE_M, y: (cy + 0.5) * CELL_SIZE_M }
}
