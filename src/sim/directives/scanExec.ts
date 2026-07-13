import type { Vec2 } from '../geo'
import { distance } from '../geo'
import { moveToward } from '../drones/kinematics'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import type { ExecStatus, RectM, ScanExec } from './types'

/** Sweep line spacing = detection diameter (2 × 50km). */
export const SWEEP_SPACING_M = 100_000

/**
 * Boustrophedon (lawnmower) waypoints covering `rect`, sweeping parallel to the
 * long axis, spaced so every rect point falls within detection range of the
 * path. Entry is from whichever end is nearest `entry`.
 */
export function buildLawnmower(
  rect: RectM,
  entry: Vec2,
  spacing = SWEEP_SPACING_M,
): Vec2[] {
  const horizontal = rect.maxX - rect.minX >= rect.maxY - rect.minY
  const acrossMin = horizontal ? rect.minY : rect.minX
  const acrossMax = horizontal ? rect.maxY : rect.maxX
  const alongMin = horizontal ? rect.minX : rect.minY
  const alongMax = horizontal ? rect.maxX : rect.maxY

  const n = Math.max(1, Math.ceil((acrossMax - acrossMin) / spacing))
  const pts: Vec2[] = []
  for (let k = 0; k <= n; k++) {
    const across = Math.min(acrossMin + k * spacing, acrossMax)
    const ends = k % 2 === 0 ? [alongMin, alongMax] : [alongMax, alongMin]
    for (const along of ends) {
      pts.push(horizontal ? { x: along, y: across } : { x: across, y: along })
    }
  }
  if (
    pts.length > 1 &&
    distance(entry, pts[0]) > distance(entry, pts[pts.length - 1])
  ) {
    pts.reverse()
  }
  return pts
}

export function makeScanExec(
  rect: RectM,
  durationMin: number,
  entry: Vec2,
  elapsedMin = 0,
): ScanExec {
  return {
    kind: 'scan',
    rect,
    durationMin,
    elapsedMin,
    waypoints: buildLawnmower(rect, entry),
    idx: 0,
  }
}

export function stepScan(exec: ScanExec, d: DroneTruth, w: GroundTruth): ExecStatus {
  exec.elapsedMin++
  const target = exec.waypoints[exec.idx]
  const { pos, heading, arrived } = moveToward(
    d.pos,
    target,
    w.cfg.speedMPerMin,
    d.heading,
  )
  d.pos = pos
  d.heading = heading
  if (arrived) {
    exec.idx++
    if (exec.idx >= exec.waypoints.length) {
      // Loop the pattern (autoPatrol runs forever; bounded scans re-cover).
      exec.waypoints = buildLawnmower(exec.rect, d.pos)
      exec.idx = 0
    }
  }
  return exec.elapsedMin >= exec.durationMin ? 'done' : 'running'
}
