import { describe, expect, it } from 'vitest'
import type { CellId } from '../geo'
import type { KnownFire } from '../belief/droneBelief'
import { mergeFire } from './merge'

const kf = (
  cellId: number,
  updatedAt: number,
  believedOut = false,
  source: KnownFire['source'] = 'self',
): KnownFire => ({ cellId, firstSeenAt: updatedAt, source, believedOut, updatedAt })

describe('mergeFire', () => {
  it('is idempotent', () => {
    const m = new Map<CellId, KnownFire>()
    mergeFire(m, kf(1, 5))
    const first = { ...m.get(1)! }
    mergeFire(m, kf(1, 5))
    expect(m.get(1)).toEqual(first)
  })

  it('is out-wins (monotonic) regardless of order', () => {
    const a = new Map<CellId, KnownFire>()
    mergeFire(a, kf(1, 10, false))
    mergeFire(a, kf(1, 5, true)) // older but says out
    expect(a.get(1)!.believedOut).toBe(true)

    const b = new Map<CellId, KnownFire>()
    mergeFire(b, kf(1, 5, true))
    mergeFire(b, kf(1, 10, false))
    expect(b.get(1)!.believedOut).toBe(true)
  })

  it('keeps the newest updatedAt and earliest firstSeenAt', () => {
    const m = new Map<CellId, KnownFire>()
    mergeFire(m, { cellId: 1, firstSeenAt: 3, source: 'self', believedOut: false, updatedAt: 3 })
    mergeFire(m, { cellId: 1, firstSeenAt: 8, source: 'gossip', believedOut: false, updatedAt: 8 })
    expect(m.get(1)!.updatedAt).toBe(8)
    expect(m.get(1)!.firstSeenAt).toBe(3)
    expect(m.get(1)!.source).toBe('gossip')
  })

  it('is commutative for believedOut and updatedAt', () => {
    const a = new Map<CellId, KnownFire>()
    mergeFire(a, kf(1, 4, false))
    mergeFire(a, kf(1, 9, true))
    const b = new Map<CellId, KnownFire>()
    mergeFire(b, kf(1, 9, true))
    mergeFire(b, kf(1, 4, false))
    expect(a.get(1)!.believedOut).toBe(b.get(1)!.believedOut)
    expect(a.get(1)!.updatedAt).toBe(b.get(1)!.updatedAt)
  })
})
