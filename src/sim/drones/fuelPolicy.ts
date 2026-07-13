import { nearestBase } from '../bases'
import { abortHead } from '../directives/queue'
import { distance } from '../geo'
import type { GroundTruth } from '../world'
import type { DroneTruth } from './drone'

/**
 * Forced-RTB policy. Triggers when the drone must head home to stay safe or
 * useful:
 *   - retardant == 0 (nothing left to drop — go rearm), or
 *   - fuel < the hard floor `lowFuelFloorL`, or
 *   - distance-aware: remaining range ≤ dist-to-nearest-base × safetyFactor +
 *     margin, so a patrolling drone turns back before it can strand itself.
 *
 * On trigger the current operator directive is aborted (reported at next sync)
 * and a forced-RTB override to the nearest base is installed above the queue.
 * A drone already beyond its range (e.g. stranded) will still burn out and
 * crash — the distance-aware trigger only prevents self-inflicted strandings
 * during normal patrol.
 */
export function applyFuelPolicy(d: DroneTruth, w: GroundTruth): void {
  if (d.status !== 'airborne') return
  if (d.override) return
  const cfg = w.cfg

  const rangeRemainingM = (d.fuelL / cfg.fuelBurnLPerMin) * cfg.speedMPerMin
  const base = nearestBase(d.pos)
  const distToBaseM = distance(d.pos, base.pos)
  const needM = distToBaseM * cfg.rtbSafetyFactor + cfg.rtbMarginKm * 1000

  const mustRtb =
    d.retardant <= 0 || d.fuelL < cfg.lowFuelFloorL || rangeRemainingM <= needM
  if (!mustRtb) return

  if (d.queue.length > 0) abortHead(d)
  d.forcedRtb = true
  d.override = { kind: 'rtb', baseId: base.id, docking: false }
}
