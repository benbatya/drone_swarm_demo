import { cellCenter, distance } from '../geo'
import type { CellId } from '../geo'
import type { FireTruth } from '../ignition'
import type { SimConfig } from '../config'
import { mergeFire } from '../comms/merge'
import type { DroneTruth } from './drone'

/**
 * Drone-mediated detection into the drone's belief:
 *   - a truth fire within `detectionRadiusM` → recorded/refreshed as active;
 *   - a believed-active fire that is within range but no longer burning →
 *     marked believedOut (the drone observes it's out).
 * Nothing here reads other drones' or the console's state.
 */
export function stepDetection(
  drone: DroneTruth,
  fires: Map<CellId, FireTruth>,
  now: number,
  cfg: SimConfig,
): void {
  if (drone.status !== 'airborne') return
  const r = cfg.detectionRadiusM
  const bel = drone.belief.fires

  // Discover / refresh active fires in range.
  for (const f of fires.values()) {
    const d = distance(drone.pos, cellCenter(f.cellId))
    if (d <= r) {
      mergeFire(bel, {
        cellId: f.cellId,
        firstSeenAt: now,
        source: 'self',
        believedOut: false,
        updatedAt: now,
      })
    }
  }

  // A believed-active fire seen absent within range is now out.
  for (const kf of bel.values()) {
    if (kf.believedOut) continue
    if (fires.has(kf.cellId)) continue
    if (distance(drone.pos, cellCenter(kf.cellId)) <= r) {
      kf.believedOut = true
      kf.updatedAt = now
    }
  }
}
