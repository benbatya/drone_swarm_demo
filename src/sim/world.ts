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
import { makeConsoleBelief, type ConsoleBelief } from './belief/consoleBelief'
import { stepGossip } from './comms/gossip'
import { stepSync } from './comms/sync'
import type { Rng } from './rng'

export interface GroundTruth {
  cfg: SimConfig
  tick: number
  fires: Map<CellId, FireTruth>
  drones: DroneTruth[]
  score: Score
  /** Console-side belief — written only by the comms sync path + operator input. */
  console: ConsoleBelief
}

export function createWorld(cfg: SimConfig): GroundTruth {
  const drones = createFleet(cfg)
  return {
    cfg,
    tick: 0,
    fires: new Map(),
    drones,
    score: makeScore(),
    console: makeConsoleBelief(drones.map((d) => d.id)),
  }
}

/** Nearest fire the drone BELIEVES active within `rangeM`, or null. */
function nearestKnownActiveFire(
  d: DroneTruth,
  rangeM: number,
): CellId | null {
  let best: CellId | null = null
  let bestD = Infinity
  for (const kf of d.belief.fires.values()) {
    if (kf.believedOut) continue
    const dist = distance(d.pos, cellCenter(kf.cellId))
    if (dist <= rangeM && dist < bestD) {
      bestD = dist
      best = kf.cellId
    }
  }
  return best
}

type Slot = 'override' | 'operator' | 'auto' | 'patrol'

/** Select the active executor for this tick per the arbitration order. */
function pickActive(d: DroneTruth, w: GroundTruth): { exec: DirectiveExec; slot: Slot } {
  if (d.override) return { exec: d.override, slot: 'override' }
  if (d.queue.length > 0) {
    if (!d.exec) activateHead(d, w.cfg)
    return { exec: d.exec!, slot: 'operator' }
  }
  // Autonomous idle: self-engage nearest known in-range fire, else autoPatrol.
  const rangeM = w.cfg.autoEngageRangeKm * 1000
  const best = d.retardant > 0 ? nearestKnownActiveFire(d, rangeM) : null
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
        completeHead(d, cfg)
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
      stepDetection(d, w.fires, now, cfg)
    }
  }

  // Intra-swarm mesh (blackout-independent), then the console link.
  stepGossip(w)
  stepSync(w)

  accrue(w.score, w.fires.size)
}
