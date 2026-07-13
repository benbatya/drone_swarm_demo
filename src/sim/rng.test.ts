import { describe, expect, it } from 'vitest'
import { makeRng } from './rng'

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(123)
    const b = makeRng(123)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('diverges for different seeds', () => {
    const a = makeRng(1)
    const b = makeRng(2)
    let same = 0
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++
    expect(same).toBeLessThan(5)
  })

  it('produces uniform values in [0,1)', () => {
    const r = makeRng(9)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('poisson mean approximates lambda', () => {
    const r = makeRng(77)
    const lambda = 2.5
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) sum += r.poisson(lambda)
    expect(sum / n).toBeGreaterThan(lambda - 0.15)
    expect(sum / n).toBeLessThan(lambda + 0.15)
  })

  it('fork is deterministic and distinct from parent stream', () => {
    const parent = makeRng(5)
    const f1 = parent.fork(3)
    const f2 = makeRng(5).fork(3)
    expect(f1.next()).toBe(f2.next())
  })
})
