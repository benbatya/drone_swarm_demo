import type { SimConfig } from './config'
import { distance, type CellId, type Vec2 } from './geo'
import { stepIgnition, type FireTruth } from './ignition'
import { accrue, makeScore, type Score } from './scoring'
import { createFleet, type DroneTruth } from './drones/drone'
import { stepDetection } from './drones/detection'
import { moveToward } from './drones/kinematics'
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

/** Distance within which a drone counts as "at home" for the M1 refuel stub. */
const DOCK_RADIUS_M = 500

function patrolTarget(d: DroneTruth): Vec2 {
  return d.patrol.waypoints[d.patrol.idx]
}

/**
 * Advance the ground truth by one sim-minute. Pipeline order:
 * clock → ignition → drone decisions/kinematics/fuel/crash → detection → score.
 *
 * M1 scope: hardcoded box patrol + a minimal low-fuel "go home and refuel"
 * stub (marked below) so the fleet stays airborne through a demo. M2 replaces
 * the stub with real directives, forced-RTB, and turnaround.
 */
export function tickWorld(w: GroundTruth, rng: Rng): void {
  w.tick++
  const now = w.tick
  const cfg = w.cfg

  // Ignition
  w.score.totalFires += stepIgnition(rng, w.fires, now, cfg)

  // Drone decisions + kinematics
  for (const d of w.drones) {
    if (d.status !== 'airborne') continue

    // --- M1 refuel stub (replaced by M2 forced-RTB) -----------------------
    const lowFuel = d.fuelL < cfg.lowFuelFloorL
    const target = lowFuel ? d.homePos : patrolTarget(d)

    const { pos, heading, arrived } = moveToward(
      d.pos,
      target,
      cfg.speedMPerMin,
      d.heading,
    )
    d.pos = pos
    d.heading = heading

    if (lowFuel && distance(d.pos, d.homePos) <= DOCK_RADIUS_M) {
      d.fuelL = cfg.fuelCapacityL // instant M1 refuel
      d.retardant = cfg.retardantLoads
    } else if (!lowFuel && arrived) {
      d.patrol.idx = (d.patrol.idx + 1) % d.patrol.waypoints.length
    }
    // ----------------------------------------------------------------------

    // Fuel burn (airborne only); exhaustion mid-air => crash, frozen forever.
    d.fuelL -= cfg.fuelBurnLPerMin
    if (d.fuelL <= 0) {
      d.fuelL = 0
      d.status = 'crashed'
      d.crashedAt = now
      continue
    }

    // Detection
    stepDetection(d, w.fires, cfg)
  }

  // Scoring — every active fire contributes one fire-minute this tick.
  accrue(w.score, w.fires.size)
}
