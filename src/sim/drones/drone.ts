import { BASES, WORLD_H_M, WORLD_W_M, type SimConfig } from '../config'
import { lngLatToMeters, type CellId, type Vec2 } from '../geo'
import { makeRng } from '../rng'
import { makeDroneBelief, type DroneBelief } from '../belief/droneBelief'
import { makeCommsState, type DroneCommsState } from '../comms/blackout'
import { makeScanExec } from '../directives/scanExec'
import { scanSectorFor } from './scanSectors'
import type {
  Directive,
  DirectiveExec,
  RectM,
  RtbExec,
  ScanExec,
  ScanOrientation,
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

  /** Current standing scan sector — operator-redefinable, defaults to the fixed
   * per-drone sector. autoPatrol sweeps this rectangle. */
  patrolRect: RectM
  /** Standing home-sector patrol; idle fallback when no known in-range fire. */
  autoPatrol: ScanExec
  /** Self-assigned idle extinguish, re-evaluated each tick. */
  autoExec: DirectiveExec | null

  /** Current sweep direction; flips each time a full sector pass completes. */
  scanOrientation: ScanOrientation
  /** Progress (0..1) through the current sweep pass; persists across diversions. */
  scanFrac: number

  /** Directive ids aborted since last sync (reported to console in M3). */
  abortedIds: string[]

  /** Cells this drone has extinguished since last sync, reported to the console
   * at the next sync (then cleared) — mirrors `abortedIds`. */
  dousedSinceSync: { cellId: CellId; at: number }[]
  /** Running total of fires this drone has extinguished (reported telemetry). */
  extinguishedTotal: number
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

/** The drone's built-in default scan sector (fixed per-drone; home-box fallback). */
export function defaultSectorFor(id: string, home: Vec2, cfg: SimConfig): RectM {
  return scanSectorFor(id) ?? homeSectorRect(home, cfg.patrolBoxKm)
}

/** Redefine a drone's standing scan sector and rebuild its patrol sweep. */
export function setPatrolSector(d: DroneTruth, rect: RectM, cfg: SimConfig): void {
  d.patrolRect = rect
  d.autoPatrol = makeScanExec(rect, Infinity, d.homePos, cfg, d.scanOrientation)
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
    for (let i = 0; i < cfg.dronesPerBase; i++) {
      const id = `${base.id}-${i + 1}`
      // Assigned scan sector (fixed per-drone; home-box fallback for exotic fleets).
      const rect = defaultSectorFor(id, home, cfg)
      drones.push({
        id,
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
        scanOrientation: 'horizontal',
        scanFrac: 0,
        patrolRect: rect,
        autoPatrol: makeScanExec(rect, Infinity, home, cfg, 'horizontal'),
        autoExec: null,
        abortedIds: [],
        dousedSinceSync: [],
        extinguishedTotal: 0,
      })
    }
  }
  return drones
}

/**
 * True when the drone is currently flying a sweep (an operator scan directive
 * or the idle autoPatrol) rather than transiting straight to a fire / base.
 * Mirrors the mode arbitration in {@link modeOf}.
 */
export function isScanning(d: DroneTruth): boolean {
  if (d.status !== 'airborne') return false
  if (d.override) return false
  if (d.exec) return d.exec.kind === 'scan'
  if (d.autoExec) return false
  return true // idle → autoPatrol
}
