import { dayOf, hourMinOf } from './clock'
import { cellCenter, metersToLngLat } from './geo'
import type { CellId } from './geo'
import type { DroneStatus, DroneTruth } from './drones/drone'
import type { GroundTruth } from './world'

// Render-facing view of the ground truth. Rebuilt each frame; kept flat and
// lng/lat-based so deck.gl layers can consume it directly.

export type DroneMode =
  | 'patrol'
  | 'scan'
  | 'extinguish'
  | 'rtb'
  | 'forced-rtb'
  | 'docked'
  | 'crashed'

export interface DroneView {
  id: string
  homeBaseId: string
  position: [number, number]
  /** Compass bearing in radians. */
  heading: number
  status: DroneStatus
  mode: DroneMode
  fuelL: number
  fuelFrac: number
  retardant: number
  knownCount: number
  queueLen: number
  currentDirectiveKind: string | null
  forcedRtb: boolean
  dockRemainingMin: number
  crashedAt: number | null
}

export interface FireView {
  cellId: CellId
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

function modeOf(d: DroneTruth): DroneMode {
  if (d.status === 'crashed') return 'crashed'
  if (d.status === 'docked') return 'docked'
  if (d.override) return 'forced-rtb'
  if (d.exec) return d.exec.kind
  if (d.autoExec) return 'extinguish'
  return 'patrol'
}

export function buildSnapshot(w: GroundTruth, meta: SnapshotMeta): TruthSnapshot {
  const drones: DroneView[] = w.drones.map((d) => {
    const ll = metersToLngLat(d.pos.x, d.pos.y)
    return {
      id: d.id,
      homeBaseId: d.homeBaseId,
      position: [ll.lng, ll.lat],
      heading: d.heading,
      status: d.status,
      mode: modeOf(d),
      fuelL: d.fuelL,
      fuelFrac: d.fuelL / w.cfg.fuelCapacityL,
      retardant: d.retardant,
      knownCount: d.knownFires.size,
      queueLen: d.queue.length,
      currentDirectiveKind: d.queue[0]?.kind ?? null,
      forcedRtb: d.forcedRtb,
      dockRemainingMin: d.dockRemainingMin,
      crashedAt: d.crashedAt ?? null,
    }
  })

  const fires: FireView[] = []
  for (const f of w.fires.values()) {
    const c = cellCenter(f.cellId)
    const ll = metersToLngLat(c.x, c.y)
    fires.push({ cellId: f.cellId, position: [ll.lng, ll.lat], ignitedAt: f.ignitedAt })
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
