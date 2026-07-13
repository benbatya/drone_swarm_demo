import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import { stepExtinguish } from './extinguishExec'
import { stepRtb } from './rtbExec'
import { makeScanExec, stepScan } from './scanExec'
import type { Directive, DirectiveExec, ExecStatus } from './types'

/** Step the active executor by one tick (it moves the drone). */
export function stepExec(
  exec: DirectiveExec,
  d: DroneTruth,
  w: GroundTruth,
  now: number,
): ExecStatus {
  switch (exec.kind) {
    case 'scan':
      return stepScan(exec, d, w)
    case 'extinguish':
      return stepExtinguish(exec, d, w, now)
    case 'rtb':
      return stepRtb(exec, d, w)
  }
}

/** Build a fresh executor for a directive, entering scans from the drone's pos. */
export function createExec(
  dir: Directive,
  d: DroneTruth,
  elapsedMin = 0,
): DirectiveExec {
  switch (dir.kind) {
    case 'scan':
      return makeScanExec(dir.rect, dir.durationMin, d.pos, elapsedMin)
    case 'extinguish':
      return { kind: 'extinguish', cellId: dir.cellId }
    case 'rtb':
      return { kind: 'rtb', baseId: dir.baseId, docking: false }
  }
}
