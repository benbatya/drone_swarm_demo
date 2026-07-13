import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../geo'
import { buildLawnmower, SWEEP_SPACING_M } from './scanExec'
import type { RectM } from './types'

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
  it('keeps every rect point within the detection radius of the path', () => {
    const rect: RectM = { minX: 0, minY: 0, maxX: 300_000, maxY: 220_000 }
    const wp = buildLawnmower(rect, { x: 0, y: 0 })
    // Spacing is the detection diameter, so worst-case gap is the radius (50km).
    expect(maxGap(rect, wp, 20_000)).toBeLessThanOrEqual(SWEEP_SPACING_M / 2 + 1)
  })

  it('enters from the traversal end nearest the drone', () => {
    const rect: RectM = { minX: 0, minY: 0, maxX: 300_000, maxY: 220_000 }
    // Horizontal sweeps run along x; the two traversal ends are at y=min and
    // y=max. Entry should start at whichever end is nearer.
    expect(buildLawnmower(rect, { x: 0, y: 0 })[0].y).toBe(0)
    expect(buildLawnmower(rect, { x: 0, y: 220_000 })[0].y).toBe(220_000)
  })
})
