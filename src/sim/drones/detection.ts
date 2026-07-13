import { cellCenter, distance } from '../geo'
import type { FireTruth } from '../ignition'
import type { CellId } from '../geo'
import type { SimConfig } from '../config'
import type { DroneTruth } from './drone'

/**
 * Drone-mediated detection: any truth fire within `detectionRadiusM` of the
 * drone is added to its known set. This is the precursor to the full
 * DroneBelief (M3); for now it records discovered cell ids so the fleet's
 * knowledge is drone-local, not omniscient.
 */
export function stepDetection(
  drone: DroneTruth,
  fires: Map<CellId, FireTruth>,
  cfg: SimConfig,
): void {
  if (drone.status !== 'airborne') return
  const r = cfg.detectionRadiusM
  for (const f of fires.values()) {
    if (drone.knownFires.has(f.cellId)) continue
    if (distance(drone.pos, cellCenter(f.cellId)) <= r) {
      drone.knownFires.add(f.cellId)
    }
  }
}
