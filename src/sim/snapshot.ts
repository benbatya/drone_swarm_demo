import { dayOf, hourMinOf } from './clock'
import { cellCenter, metersToLngLat } from './geo'
import type { DroneStatus } from './drones/drone'
import type { GroundTruth } from './world'

// Render-facing view of the ground truth. Rebuilt each frame; kept flat and
// lng/lat-based so deck.gl layers can consume it directly.

export interface DroneView {
  id: string
  position: [number, number]
  /** Compass bearing in radians. */
  heading: number
  status: DroneStatus
  fuelL: number
  fuelFrac: number
  retardant: number
  knownCount: number
}

export interface FireView {
  position: [number, number]
  ignitedAt: number
}

export interface TruthSnapshot {
  version: number
  tick: number
  day: number
  hourMin: string
  running: boolean
  speed: number
  score: {
    fireMinutes: number
    totalFires: number
    doused: number
    activeFires: number
  }
  drones: DroneView[]
  fires: FireView[]
}

export interface SnapshotMeta {
  running: boolean
  speed: number
  version: number
}

export function buildSnapshot(w: GroundTruth, meta: SnapshotMeta): TruthSnapshot {
  const drones: DroneView[] = w.drones.map((d) => {
    const ll = metersToLngLat(d.pos.x, d.pos.y)
    return {
      id: d.id,
      position: [ll.lng, ll.lat],
      heading: d.heading,
      status: d.status,
      fuelL: d.fuelL,
      fuelFrac: d.fuelL / w.cfg.fuelCapacityL,
      retardant: d.retardant,
      knownCount: d.knownFires.size,
    }
  })

  const fires: FireView[] = []
  for (const f of w.fires.values()) {
    const c = cellCenter(f.cellId)
    const ll = metersToLngLat(c.x, c.y)
    fires.push({ position: [ll.lng, ll.lat], ignitedAt: f.ignitedAt })
  }

  return {
    version: meta.version,
    tick: w.tick,
    day: dayOf(w.tick),
    hourMin: hourMinOf(w.tick),
    running: meta.running,
    speed: meta.speed,
    score: {
      fireMinutes: w.score.fireMinutes,
      totalFires: w.score.totalFires,
      doused: w.score.doused,
      activeFires: w.fires.size,
    },
    drones,
    fires,
  }
}
