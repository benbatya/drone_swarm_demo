import { baseById } from '../bases'
import { moveToward } from '../drones/kinematics'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import type { ExecStatus, RtbExec } from './types'

/**
 * Return to base: transit → dock (status 'docked', turnaround countdown) →
 * refuel+rearm → done. Used both for operator RTB directives and, via
 * `drone.override`, for forced fuel/retardant RTB.
 */
export function stepRtb(exec: RtbExec, d: DroneTruth, w: GroundTruth): ExecStatus {
  const cfg = w.cfg
  if (exec.docking) {
    d.dockRemainingMin -= 1
    if (d.dockRemainingMin <= 0) {
      d.fuelL = cfg.fuelCapacityL
      d.retardant = cfg.retardantLoads
      d.status = 'airborne'
      return 'done'
    }
    return 'running'
  }

  const base = baseById(exec.baseId)
  const { pos, heading, arrived } = moveToward(
    d.pos,
    base.pos,
    cfg.speedMPerMin,
    d.heading,
  )
  d.pos = pos
  d.heading = heading
  if (arrived) {
    d.status = 'docked'
    d.dockRemainingMin = cfg.turnaroundMin
    exec.docking = true
  }
  return 'running'
}
