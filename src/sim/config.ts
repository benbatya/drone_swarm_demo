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

// ---------------------------------------------------------------------------
// Simulation tunables
// ---------------------------------------------------------------------------

export const TICKS_PER_DAY = 1440 // 1 tick = 1 sim-minute
export const SEASON_DAYS = 30
export const TICKS_PER_SEASON = TICKS_PER_DAY * SEASON_DAYS // 43,200
/**
 * Wall-clock seconds per sim-tick at ×1 realtime (1 tick = 1 sim-minute).
 * The speed multiplier is literal "× realtime": tick rate = speed / REAL_SEC_PER_TICK
 * ticks per second. So ×1800 → 30 ticks/s (one tick every 1/30 s), ×30 → 0.5 ticks/s.
 */
export const REAL_SEC_PER_TICK = 60
/** Playback speed multipliers (× realtime). ×1 = true realtime (1 tick/min). */
export const SPEED_MULTIPLIERS = [1, 30, 120, 480, 960, 1800] as const
/** Default playback speed (× realtime) — true realtime. */
export const DEFAULT_SPEED = 1
/** Upper bound on ticks processed in a single rAF frame (fast-forward cap). */
export const MAX_TICKS_PER_FRAME = 600

export interface SimConfig {
  seed: number
  dronesPerBase: number
  /** Cruise speed in meters per sim-minute. */
  speedMPerMin: number
  /** Fire detection radius (meters). */
  detectionRadiusM: number
  /** Drone↔drone gossip range (meters). */
  gossipRangeM: number
  fuelCapacityL: number
  /** Operational range (km) — primary knob; fuelBurnLPerMin is derived from it. */
  operationalRangeKm: number
  /** Derived: liters burned per sim-minute aloft. */
  fuelBurnLPerMin: number
  /** Forced-RTB fuel floor (liters) — a hard minimum reserve. */
  lowFuelFloorL: number
  /** Distance-aware RTB: trigger when remaining range ≤ dist-to-base × this. */
  rtbSafetyFactor: number
  /** Extra safety margin (km) added to the distance-aware RTB trigger. */
  rtbMarginKm: number
  retardantLoads: number
  turnaroundMin: number
  /** Mean new fires per sim-minute (Poisson λ). */
  ignitionLambdaPerMin: number
  /** No fire may ignite within this many meters of a base. */
  baseExclusionM: number
  /** Idle self-engage range (km). */
  autoEngageRangeKm: number
  /** Home-sector autoPatrol box side length (km). */
  patrolBoxKm: number

  // --- Comms ---
  /** Normal drone-initiated sync cadence (sim-min). */
  syncCadenceMin: number
  /** First retry interval after a failed sync (then halves to 1). */
  syncRetryStartMin: number
  /** Contact age (min) past which the console reports a drone MISSING. */
  missingThresholdMin: number
  /** Contact age (min) past which the console shows an amber "stale" cue. */
  staleThresholdMin: number
  /** Connected-window duration bounds (min). */
  connMinMin: number
  connMaxMin: number
  /** Routine dark-window duration bounds (min). */
  routineDarkMinMin: number
  routineDarkMaxMin: number
  /** Probability a given dark window is a deep outage. */
  deepOutageProb: number
  /** Deep-outage duration bounds (min). */
  deepDarkMinMin: number
  deepDarkMaxMin: number
}

const BASE_CONFIG: Omit<SimConfig, 'fuelBurnLPerMin'> = {
  seed: 1337,
  dronesPerBase: 2,
  speedMPerMin: 1680,
  detectionRadiusM: 10_000,
  gossipRangeM: 50_000,
  fuelCapacityL: 2000,
  operationalRangeKm: 600,
  lowFuelFloorL: 120,
  rtbSafetyFactor: 1.25,
  rtbMarginKm: 25,
  retardantLoads: 10,
  turnaroundMin: 60,
  ignitionLambdaPerMin: 1 / 60,
  baseExclusionM: 1000,
  autoEngageRangeKm: 168,
  patrolBoxKm: 200,
  syncCadenceMin: 32,
  syncRetryStartMin: 16,
  missingThresholdMin: 64,
  staleThresholdMin: 40,
  connMinMin: 15,
  connMaxMin: 35,
  routineDarkMinMin: 10,
  routineDarkMaxMin: 40,
  deepOutageProb: 0.05,
  deepDarkMinMin: 80,
  deepDarkMaxMin: 220,
}

/** Build a SimConfig, deriving fuelBurnLPerMin so range/capacity stay consistent. */
export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  const merged = { ...BASE_CONFIG, ...overrides }
  const fuelBurnLPerMin =
    (merged.fuelCapacityL * merged.speedMPerMin) /
    (merged.operationalRangeKm * 1000)
  return { ...merged, fuelBurnLPerMin }
}
