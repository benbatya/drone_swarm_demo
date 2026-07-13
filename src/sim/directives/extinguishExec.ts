import { cellCenter, distance } from '../geo'
import { moveToward } from '../drones/kinematics'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import type { ExecStatus, ExtinguishExec } from './types'

/** A retardant drop lands when the drone is within this distance of the cell. */
export const DROP_RADIUS_M = 50

/** Mark a cell believed-out in the drone's belief (if it knows of it). */
function markBeliefOut(d: DroneTruth, cellId: number, now: number): void {
  const kf = d.belief.fires.get(cellId)
  if (kf && !kf.believedOut) {
    kf.believedOut = true
    kf.updatedAt = now
  }
}

export function stepExtinguish(
  exec: ExtinguishExec,
  d: DroneTruth,
  w: GroundTruth,
  now: number,
): ExecStatus {
  const fire = w.fires.get(exec.cellId)
  if (!fire) {
    // Already out (doused by a peer, or gone). Complete without dropping.
    markBeliefOut(d, exec.cellId, now)
    return 'done'
  }
  const target = cellCenter(exec.cellId)
  const { pos, heading } = moveToward(d.pos, target, w.cfg.speedMPerMin, d.heading)
  d.pos = pos
  d.heading = heading
  if (distance(d.pos, target) <= DROP_RADIUS_M) {
    fire.extinguishedAt = now
    fire.extinguishedBy = d.id
    w.fires.delete(exec.cellId)
    w.score.doused++
    d.retardant = Math.max(0, d.retardant - 1)
    markBeliefOut(d, exec.cellId, now)
    return 'done'
  }
  return 'running'
}
