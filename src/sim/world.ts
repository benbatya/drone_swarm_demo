import type { SimConfig } from './config'
import { cellCenter, distance, type CellId } from './geo'
import { stepIgnition, type FireTruth } from './ignition'
import { accrue, makeScore, type Score } from './scoring'
import { createFleet, type DroneTruth } from './drones/drone'
import { stepDetection } from './drones/detection'
import { applyFuelPolicy } from './drones/fuelPolicy'
import { activateHead, completeHead } from './directives/queue'
import { stepExec } from './directives/executor'
import type { DirectiveExec } from './directives/types'
import type { Rng } from './rng'

export interface GroundTruth {
  cfg: SimConfig
  tick: number
  fires: Map<CellId, FireTruth>
  drones: DroneTruth[]
  score: Score
}

export function createWorld(cfg: SimConfig): GroundTruth {
  return {
    cfg,
    tick: 0,
    fires: new Map(),
    drones: createFleet(cfg),
    score: makeScore(),
  }
}

/** Nearest active fire the drone knows about within `rangeM`, or null. */
function nearestKnownActiveFire(
  d: DroneTruth,
  w: GroundTruth,
  rangeM: number,
): CellId | null {
  let best: CellId | null = null
  let bestD = Infinity
  for (const cid of d.knownFires) {
    if (!w.fires.has(cid)) continue
    const dist = distance(d.pos, cellCenter(cid))
    if (dist <= rangeM && dist < bestD) {
      bestD = dist
      best = cid
    }
  }
  return best
}

type Slot = 'override' | 'operator' | 'auto' | 'patrol'

/** Select the active executor for this tick per the arbitration order. */
function pickActive(d: DroneTruth, w: GroundTruth): { exec: DirectiveExec; slot: Slot } {
  if (d.override) return { exec: d.override, slot: 'override' }
  if (d.queue.length > 0) {
    if (!d.exec) activateHead(d)
    return { exec: d.exec!, slot: 'operator' }
  }
  // Autonomous idle: self-engage nearest known in-range fire, else autoPatrol.
  const rangeM = w.cfg.autoEngageRangeKm * 1000
  const best = d.retardant > 0 ? nearestKnownActiveFire(d, w, rangeM) : null
  if (best !== null) {
    if (!(d.autoExec?.kind === 'extinguish' && d.autoExec.cellId === best)) {
      d.autoExec = { kind: 'extinguish', cellId: best }
    }
    return { exec: d.autoExec, slot: 'auto' }
  }
  d.autoExec = null
  return { exec: d.autoPatrol, slot: 'patrol' }
}

/**
 * Advance the ground truth by one sim-minute:
 * clock → ignition → per-drone (fuel policy → active exec → fuel/crash →
 * detection) → scoring.
 */
export function tickWorld(w: GroundTruth, rng: Rng): void {
  w.tick++
  const now = w.tick
  const cfg = w.cfg

  w.score.totalFires += stepIgnition(rng, w.fires, now, cfg)

  for (const d of w.drones) {
    if (d.status === 'crashed') continue

    if (d.status === 'airborne') applyFuelPolicy(d, w)

    const { exec, slot } = pickActive(d, w)
    const status = stepExec(exec, d, w, now)
    if (status === 'done') {
      if (slot === 'override') {
        d.override = null
        d.forcedRtb = false
      } else if (slot === 'operator') {
        completeHead(d)
      } else if (slot === 'auto') {
        d.autoExec = null
      }
      // patrol never completes
    }

    // Fuel burn + crash + detection apply only while airborne (docked drones
    // are on the ground doing turnaround inside their RTB exec).
    if (d.status === 'airborne') {
      d.fuelL -= cfg.fuelBurnLPerMin
      if (d.fuelL <= 0) {
        d.fuelL = 0
        d.status = 'crashed'
        d.crashedAt = now
        continue
      }
      stepDetection(d, w.fires, cfg)
    }
  }

  accrue(w.score, w.fires.size)
}
