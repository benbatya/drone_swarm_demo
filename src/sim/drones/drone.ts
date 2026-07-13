import { BASES, WORLD_H_M, WORLD_W_M, type SimConfig } from '../config'
import { lngLatToMeters, type Vec2 } from '../geo'
import { makeRng } from '../rng'
import { makeDroneBelief, type DroneBelief } from '../belief/droneBelief'
import { makeCommsState, type DroneCommsState } from '../comms/blackout'
import { makeScanExec } from '../directives/scanExec'
import type {
  Directive,
  DirectiveExec,
  RectM,
  RtbExec,
  ScanExec,
} from '../directives/types'

export type DroneStatus = 'airborne' | 'docked' | 'crashed'

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
  /** Turnaround countdown while docked (sim-minutes). */
  dockRemainingMin: number

  /** This drone's belief: fires from own detection + gossip. */
  belief: DroneBelief
  /** Blackout schedule + sync scheduling state. */
  comms: DroneCommsState

  // Directive execution
  queue: Directive[]
  exec: DirectiveExec | null
  execDirId: string | null
  /** Saved scan progress (elapsedMin) by directive id, for resume-after-preempt. */
  scanProgress: Map<string, number>

  /** Forced RTB (fuel/retardant) — above the queue, not a directive. */
  override: RtbExec | null
  forcedRtb: boolean

  /** Standing home-sector patrol; idle fallback when no known in-range fire. */
  autoPatrol: ScanExec
  /** Self-assigned idle extinguish, re-evaluated each tick. */
  autoExec: DirectiveExec | null

  /** Directive ids aborted since last sync (reported to console in M3). */
  abortedIds: string[]
}

function clampToWorld(v: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(v.x, 0), WORLD_W_M),
    y: Math.min(Math.max(v.y, 0), WORLD_H_M),
  }
}

/** A square home-sector rectangle centered on `home`, clamped to the world. */
export function homeSectorRect(home: Vec2, sideKm: number): RectM {
  const h = (sideKm * 1000) / 2
  const min = clampToWorld({ x: home.x - h, y: home.y - h })
  const max = clampToWorld({ x: home.x + h, y: home.y + h })
  return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y }
}

/** Build the initial fleet: `dronesPerBase` drones at each base, full tanks. */
export function createFleet(cfg: SimConfig): DroneTruth[] {
  const drones: DroneTruth[] = []
  // Dedicated deterministic stream for per-drone blackout schedules, kept
  // independent of the tick RNG so comms don't perturb ignition and vice versa.
  const commsRng = makeRng((cfg.seed ^ 0x5eed) >>> 0)
  let globalIdx = 0
  for (const base of BASES) {
    const home = lngLatToMeters(base.lng, base.lat)
    const rect = homeSectorRect(home, cfg.patrolBoxKm)
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
        dockRemainingMin: 0,
        belief: makeDroneBelief(),
        comms: makeCommsState(commsRng.fork(globalIdx++), cfg),
        queue: [],
        exec: null,
        execDirId: null,
        scanProgress: new Map<string, number>(),
        override: null,
        forcedRtb: false,
        autoPatrol: makeScanExec(rect, Infinity, home),
        autoExec: null,
        abortedIds: [],
      })
    }
  }
  return drones
}
