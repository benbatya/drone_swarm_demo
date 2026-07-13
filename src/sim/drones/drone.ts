import { BASES, WORLD_H_M, WORLD_W_M, type SimConfig } from '../config'
import { lngLatToMeters, type CellId, type Vec2 } from '../geo'

export type DroneStatus = 'airborne' | 'docked' | 'crashed'

export interface Patrol {
  waypoints: Vec2[]
  idx: number
}

export interface DroneTruth {
  id: string
  homeBaseId: string
  homePos: Vec2
  pos: Vec2
  /** Compass bearing in radians (0 = north, clockwise). */
  heading: number
  fuelL: number
  retardant: number
  status: DroneStatus
  crashedAt?: number
  /** Fires this drone has personally detected (precursor to DroneBelief, M3). */
  knownFires: Set<CellId>
  patrol: Patrol
}

function clampToWorld(v: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(v.x, 0), WORLD_W_M),
    y: Math.min(Math.max(v.y, 0), WORLD_H_M),
  }
}

/** Corners of a square patrol box centered on `home`, clamped to the world. */
export function patrolBox(home: Vec2, sideM: number): Vec2[] {
  const h = sideM / 2
  return [
    { x: home.x - h, y: home.y - h },
    { x: home.x + h, y: home.y - h },
    { x: home.x + h, y: home.y + h },
    { x: home.x - h, y: home.y + h },
  ].map(clampToWorld)
}

/** Build the initial fleet: `dronesPerBase` drones at each base, full tanks. */
export function createFleet(cfg: SimConfig): DroneTruth[] {
  const drones: DroneTruth[] = []
  for (const base of BASES) {
    const home = lngLatToMeters(base.lng, base.lat)
    const waypoints = patrolBox(home, cfg.patrolBoxKm * 1000)
    for (let i = 0; i < cfg.dronesPerBase; i++) {
      drones.push({
        id: `${base.id}-${i + 1}`,
        homeBaseId: base.id,
        homePos: home,
        pos: { x: home.x, y: home.y },
        heading: 0,
        fuelL: cfg.fuelCapacityL,
        retardant: cfg.retardantLoads,
        status: 'airborne',
        knownFires: new Set<CellId>(),
        // Stagger start corner so co-based drones cover different ground.
        patrol: { waypoints, idx: i % waypoints.length },
      })
    }
  }
  return drones
}
