import type { SimConfig } from '../config'
import type { Vec2 } from '../geo'
import { distance } from '../geo'
import { moveToward } from '../drones/kinematics'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import type { ExecStatus, RectM, ScanExec, ScanOrientation } from './types'

/** Sweep-line spacing = fire-detection diameter (2 × detection radius). */
export function sweepSpacingM(cfg: SimConfig): number {
  return 2 * cfg.detectionRadiusM
}

/**
 * Boustrophedon (lawnmower) waypoints covering `rect`, sweeping parallel to the
 * chosen axis, spaced so every rect point falls within detection range of the
 * path. `orientation` picks the leg direction (horizontal = long legs along x).
 * Entry is from whichever end is nearest `entry`.
 */
export function buildLawnmower(
  rect: RectM,
  entry: Vec2,
  spacing: number,
  orientation: ScanOrientation,
): Vec2[] {
  const horizontal = orientation === 'horizontal'
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

// --- Path geometry helpers (used here and by the console dead-reckoner) -----

/** Total polyline length in meters. */
export function pathLength(pts: Vec2[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += distance(pts[i - 1], pts[i])
  return len
}

/** Point at arc-length `s` (clamped to [0, length]) along the polyline. */
export function pointAtDistance(pts: Vec2[], s: number): Vec2 {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (s <= 0) return pts[0]
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = distance(pts[i - 1], pts[i])
    if (acc + seg >= s) {
      const t = seg > 0 ? (s - acc) / seg : 0
      return {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      }
    }
    acc += seg
  }
  return pts[pts.length - 1]
}

/** Arc-length of the closest point on the polyline to `p`. */
export function nearestArcLength(pts: Vec2[], p: Vec2): number {
  let best = Infinity
  let bestS = 0
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
    const projx = a.x + t * dx
    const projy = a.y + t * dy
    const d = Math.hypot(p.x - projx, p.y - projy)
    if (d < best) {
      best = d
      bestS = acc + t * Math.sqrt(l2)
    }
    acc += Math.sqrt(l2)
  }
  return bestS
}

/** Fraction (0..1) of the current sweep pass the drone has covered. */
function passFrac(pts: Vec2[], pos: Vec2): number {
  const len = pathLength(pts)
  if (len <= 0) return 0
  return Math.min(1, Math.max(0, nearestArcLength(pts, pos) / len))
}

function flip(o: ScanOrientation): ScanOrientation {
  return o === 'horizontal' ? 'vertical' : 'horizontal'
}

export function makeScanExec(
  rect: RectM,
  durationMin: number,
  entry: Vec2,
  cfg: SimConfig,
  orientation: ScanOrientation,
  elapsedMin = 0,
): ScanExec {
  return {
    kind: 'scan',
    rect,
    durationMin,
    elapsedMin,
    waypoints: buildLawnmower(rect, entry, sweepSpacingM(cfg), orientation),
    idx: 0,
    orientation,
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
      // A full sweep of the sector is complete: alternate the sweep direction
      // and re-cover (autoPatrol runs forever; bounded scans re-cover too).
      d.scanOrientation = flip(d.scanOrientation)
      exec.orientation = d.scanOrientation
      exec.waypoints = buildLawnmower(
        exec.rect,
        d.pos,
        sweepSpacingM(w.cfg),
        exec.orientation,
      )
      exec.idx = 0
    }
  }
  // Track how far through the current pass we are, so the operator can see it
  // and the drone resumes here after diverting to a fire / RTB.
  d.scanFrac = passFrac(exec.waypoints, d.pos)
  return exec.elapsedMin >= exec.durationMin ? 'done' : 'running'
}
