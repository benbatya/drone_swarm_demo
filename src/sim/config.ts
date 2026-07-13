// SimConfig + world constants. Everything tunable lives here so the God-Mode
// config panel (M4) and tests can retune without touching logic.
//
// M0 scope: geography (bbox, grid, projection reference) and the four bases.
// Later milestones extend this with drone/fuel/comms tunables.

export const M_PER_DEG = 111195 // meters per degree latitude (also per degree lon at the equator)

/** NorCal bounding box (degrees). Origin of the local meters plane is the SW corner. */
export const BBOX = {
  south: 37.8,
  north: 42.1,
  west: -124.5,
  east: -119.9,
} as const

/** Reference latitude for the equirectangular projection's longitude scale. */
export const REF_LAT = 39.95
export const REF_LAT_RAD = (REF_LAT * Math.PI) / 180
export const COS_REF_LAT = Math.cos(REF_LAT_RAD)

/** Simulation grid cell size in meters (sparse — only fires are ever stored). */
export const CELL_SIZE_M = 10

/** World extent in local meters. */
export const WORLD_W_M = (BBOX.east - BBOX.west) * M_PER_DEG * COS_REF_LAT
export const WORLD_H_M = (BBOX.north - BBOX.south) * M_PER_DEG

/** Grid dimensions. cellId = cy * GRID_COLS + cx stays a safe integer (~1.9e9 max). */
export const GRID_COLS = Math.ceil(WORLD_W_M / CELL_SIZE_M)
export const GRID_ROWS = Math.ceil(WORLD_H_M / CELL_SIZE_M)

export interface Base {
  id: string
  name: string
  lat: number
  lng: number
}

export const BASES: Base[] = [
  { id: 'redding', name: 'Redding', lat: 40.59, lng: -122.39 },
  { id: 'chico', name: 'Chico', lat: 39.73, lng: -121.84 },
  { id: 'weed', name: 'Weed', lat: 41.42, lng: -122.39 },
  { id: 'sacramento', name: 'Sacramento', lat: 38.58, lng: -121.49 },
]

/** Geographic center of the bbox — used to frame the initial map view. */
export const WORLD_CENTER = {
  lng: (BBOX.west + BBOX.east) / 2,
  lat: (BBOX.south + BBOX.north) / 2,
} as const
