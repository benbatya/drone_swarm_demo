import type { SimConfig } from '../config'
import type { Vec2 } from '../geo'
import { distance } from '../geo'
import { landExtentAlongAxis } from '../land'
import { moveToward } from '../drones/kinematics'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import type { ExecStatus, RectM, ScanExec, ScanOrientation } from './types'

/** Sweep-line spacing = fire-detection diameter (2 × detection radius). */
export function sweepSpacingM(cfg: SimConfig): number {
  return 2 * cfg.detectionRadiusM
}

/**
 * Memoized land-clipped sweeps, keyed by (rect, spacing, orientation). The
 * clipped shape is deterministic in those three, and re-derived on every sweep
 * re-cover plus by the console's blackout dead-reckoner and the map preview, so
 * caching keeps those cheap and guarantees they stay byte-identical to truth.
 */
const lawnmowerCache = new Map<string, Vec2[]>()

/**
 * Boustrophedon (lawnmower) waypoints covering the LAND within `rect`, sweeping
 * parallel to the chosen axis and spaced so every on-land point falls within
 * detection range of the path. Each leg is clipped to its row's on-land span so
 * the sweep's turnarounds follow the coastline rather than running out over the
 * ocean; rows that are entirely water are dropped. If `rect` holds no land at
 * all, the full rectangle is swept (fail-open — see land.ts). `orientation`
 * picks the leg direction (horizontal = long legs along x); entry is from
 * whichever end is nearest `entry`.
 */
export function buildLawnmower(
  rect: RectM,
  entry: Vec2,
  spacing: number,
  orientation: ScanOrientation,
): Vec2[] {
  const key = `${rect.minX},${rect.minY},${rect.maxX},${rect.maxY}|${spacing}|${orientation}`
  let base = lawnmowerCache.get(key)
  if (!base) {
    base = buildLawnmowerBase(rect, spacing, orientation)
    lawnmowerCache.set(key, base)
  }
  // Orient toward `entry`: start from whichever end of the fixed path is nearer.
  // Return a fresh array either way so callers never mutate the cached base.
  if (
    base.length > 1 &&
    distance(entry, base[0]) > distance(entry, base[base.length - 1])
  ) {
    return base.slice().reverse()
  }
  return base.slice()
}

/** The land-clipped sweep in its canonical (pre-entry-orientation) direction. */
function buildLawnmowerBase(
  rect: RectM,
  spacing: number,
  orientation: ScanOrientation,
): Vec2[] {
  const horizontal = orientation === 'horizontal'
  const acrossMin = horizontal ? rect.minY : rect.minX
  const acrossMax = horizontal ? rect.maxY : rect.maxX
  const alongMin = horizontal ? rect.minX : rect.minY
  const alongMax = horizontal ? rect.maxX : rect.maxY

  const n = Math.max(1, Math.ceil((acrossMax - acrossMin) / spacing))
  const axis: 'x' | 'y' = horizontal ? 'x' : 'y'
  const clipStep = spacing / 4 // ≈ detection radius / 2 — fine enough to find the coast
  const mk = (along: number, across: number): Vec2 =>
    horizontal ? { x: along, y: across } : { x: across, y: along }

  // One land-clipped leg per row, dropping rows that are entirely water.
  const rows: { across: number; lo: number; hi: number }[] = []
  for (let k = 0; k <= n; k++) {
    const across = Math.min(acrossMin + k * spacing, acrossMax)
    const span = landExtentAlongAxis(axis, across, alongMin, alongMax, clipStep)
    if (span) rows.push({ across, lo: span[0], hi: span[1] })
  }

  // Fail-open: a rect with no land at all sweeps the full rectangle (the prior
  // behavior) so stepScan never faces an empty waypoint list.
  if (rows.length === 0) {
    const pts: Vec2[] = []
    for (let k = 0; k <= n; k++) {
      const across = Math.min(acrossMin + k * spacing, acrossMax)
      const ends = k % 2 === 0 ? [alongMin, alongMax] : [alongMax, alongMin]
      for (const along of ends) pts.push(mk(along, across))
    }
    return pts
  }

  // Boustrophedon over the kept rows: begin each row from the end nearest the
  // previous row's exit so turnarounds stay short and the polyline contiguous.
  const pts: Vec2[] = []
  let prev: Vec2 | null = null
  for (const { across, lo, hi } of rows) {
    const a: Vec2 = mk(lo, across)
    const b: Vec2 = mk(hi, across)
    // Start this row from whichever end is nearer the previous row's exit.
    const nearB: boolean = prev !== null && distance(prev, b) < distance(prev, a)
    const first: Vec2 = nearB ? b : a
    const second: Vec2 = nearB ? a : b
    pts.push(first, second)
    prev = second
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

/**
 * Heading of the polyline's travel direction at arc-length `s`, in the sim's
 * heading convention (x = sin(h), y = cos(h) ⇒ h = atan2(dx, dy)). Lets the
 * console dead-reckon a scanning drone's orientation ALONG its sweep during a
 * blackout instead of freezing it at the last reported heading. Clamps like
 * pointAtDistance: s ≤ 0 → first segment, s ≥ length → last segment.
 */
export function headingAtDistance(pts: Vec2[], s: number): number {
  if (pts.length < 2) return 0
  let acc = 0
  let last = 1
  for (let i = 1; i < pts.length; i++) {
    const seg = distance(pts[i - 1], pts[i])
    if (seg > 0) {
      last = i
      if (acc + seg >= s) return Math.atan2(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
    acc += seg
  }
  return Math.atan2(pts[last].x - pts[last - 1].x, pts[last].y - pts[last - 1].y)
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
