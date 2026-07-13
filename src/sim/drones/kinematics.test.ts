import { describe, expect, it } from 'vitest'
import { moveToward } from './kinematics'

describe('moveToward', () => {
  it('takes a partial step toward a distant target', () => {
    const r = moveToward({ x: 0, y: 0 }, { x: 0, y: 1000 }, 100)
    expect(r.arrived).toBe(false)
    expect(r.pos.y).toBeCloseTo(100, 6)
    expect(r.pos.x).toBeCloseTo(0, 6)
    expect(r.heading).toBeCloseTo(0, 6) // due north
  })

  it('snaps to the target when within one step', () => {
    const r = moveToward({ x: 0, y: 0 }, { x: 30, y: 40 }, 100)
    expect(r.arrived).toBe(true)
    expect(r.pos).toEqual({ x: 30, y: 40 })
  })

  it('reports an eastward bearing of +pi/2', () => {
    const r = moveToward({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100)
    expect(r.heading).toBeCloseTo(Math.PI / 2, 6)
  })

  it('preserves heading when already at the target', () => {
    const r = moveToward({ x: 5, y: 5 }, { x: 5, y: 5 }, 100, 1.234)
    expect(r.arrived).toBe(true)
    expect(r.heading).toBe(1.234)
  })
})
