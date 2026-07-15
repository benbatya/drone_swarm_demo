import { describe, expect, it } from 'vitest'
import { makeConfig } from '../config'
import type { Vec2 } from '../geo'
import {
  buildLawnmower,
  headingAtDistance,
  makeScanExec,
  stepScan,
  sweepSpacingM,
} from './scanExec'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import type { RectM } from './types'

const SPACING = sweepSpacingM(makeConfig())

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function maxGap(rect: RectM, wp: Vec2[], step: number): number {
  let worst = 0
  for (let x = rect.minX; x <= rect.maxX; x += step) {
    for (let y = rect.minY; y <= rect.maxY; y += step) {
      let best = Infinity
      for (let i = 0; i < wp.length - 1; i++) {
        best = Math.min(best, segDist({ x, y }, wp[i], wp[i + 1]))
      }
      worst = Math.max(worst, best)
    }
  }
  return worst
}

describe('lawnmower coverage', () => {
  it('spacing is twice the fire-detection radius', () => {
    expect(SPACING).toBe(2 * makeConfig().detectionRadiusM)
  })

  it('keeps every rect point within the detection radius of the path', () => {
    const rect: RectM = { minX: 0, minY: 0, maxX: 300_000, maxY: 220_000 }
    const wp = buildLawnmower(rect, { x: 0, y: 0 }, SPACING, 'horizontal')
    // Spacing is the detection diameter, so worst-case gap is the radius.
    expect(maxGap(rect, wp, 5_000)).toBeLessThanOrEqual(SPACING / 2 + 1)
  })

  it('enters from the traversal end nearest the drone', () => {
    const rect: RectM = { minX: 0, minY: 0, maxX: 300_000, maxY: 220_000 }
    // Horizontal sweeps run along x; the two traversal ends are at y=min and
    // y=max. Entry should start at whichever end is nearer.
    expect(buildLawnmower(rect, { x: 0, y: 0 }, SPACING, 'horizontal')[0].y).toBe(0)
    expect(buildLawnmower(rect, { x: 0, y: 220_000 }, SPACING, 'horizontal')[0].y).toBe(220_000)
  })

  it('flips sweep orientation on each completed pass and tracks 0..1 progress', () => {
    const cfg = makeConfig()
    // Tiny sector so a full pass completes in a handful of ticks.
    const rect: RectM = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const d = {
      pos: { x: 0, y: 0 },
      heading: 0,
      scanOrientation: 'horizontal' as const,
      scanFrac: 0,
    } as unknown as DroneTruth
    const w = { cfg } as unknown as GroundTruth
    const exec = makeScanExec(rect, Infinity, d.pos, cfg, 'horizontal')

    let steps = 0
    while (d.scanOrientation === 'horizontal' && steps < 200) {
      stepScan(exec, d, w)
      expect(d.scanFrac).toBeGreaterThanOrEqual(0)
      expect(d.scanFrac).toBeLessThanOrEqual(1)
      steps++
    }
    // A completed pass toggled horizontal → vertical, and the exec rebuilt to match.
    expect(d.scanOrientation).toBe('vertical')
    expect(exec.orientation).toBe('vertical')
    expect(steps).toBeLessThan(200)
  })

  it('orientation transposes the sweep direction', () => {
    const rect: RectM = { minX: 0, minY: 0, maxX: 300_000, maxY: 220_000 }
    // Horizontal: the first leg runs along x (endpoints share y).
    const h = buildLawnmower(rect, { x: 0, y: 0 }, SPACING, 'horizontal')
    expect(h[0].y).toBe(h[1].y)
    expect(h[0].x).not.toBe(h[1].x)
    // Vertical: the first leg runs along y (endpoints share x).
    const v = buildLawnmower(rect, { x: 0, y: 0 }, SPACING, 'vertical')
    expect(v[0].x).toBe(v[1].x)
    expect(v[0].y).not.toBe(v[1].y)
  })
})

describe('headingAtDistance', () => {
  // Heading convention: x = sin(h), y = cos(h) ⇒ east = atan2(1,0) = +π/2,
  // north = atan2(0,1) = 0. An L-shaped path: 100 m east, then 100 m north.
  const path: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 }, // east leg
    { x: 100, y: 100 }, // north leg
  ]

  it('returns the travel direction of the segment at arc-length s', () => {
    expect(headingAtDistance(path, 50)).toBeCloseTo(Math.PI / 2) // mid east leg
    expect(headingAtDistance(path, 150)).toBeCloseTo(0) // mid north leg
  })

  it('clamps like pointAtDistance at both ends', () => {
    expect(headingAtDistance(path, -10)).toBeCloseTo(Math.PI / 2) // before start → first seg
    expect(headingAtDistance(path, 999)).toBeCloseTo(0) // past end → last seg
  })

  it('turns along a real horizontal lawnmower leg', () => {
    const rect: RectM = { minX: 0, minY: 0, maxX: 300_000, maxY: 220_000 }
    const wp = buildLawnmower(rect, { x: 0, y: 0 }, SPACING, 'horizontal')
    // The first leg runs along x, so the heading is horizontal (|cos|≈0, |sin|≈1).
    const h = headingAtDistance(wp, 1000)
    expect(Math.abs(Math.cos(h))).toBeLessThan(1e-6)
    expect(Math.abs(Math.sin(h))).toBeCloseTo(1)
  })
})
