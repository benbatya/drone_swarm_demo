import { describe, expect, it } from 'vitest'
import { makeConfig } from './config'
import { SimRunner } from './simRunner'

describe('SimRunner', () => {
  it('builds a valid initial snapshot before starting', () => {
    const r = new SimRunner(makeConfig())
    const s = r.getStoreSnapshot()
    expect(s.drones.length).toBe(8)
    expect(s.console.drones.length).toBe(8)
    expect(s.seasonComplete).toBe(false)
  })

  it('reconfigure resets the world deterministically', () => {
    const r = new SimRunner(makeConfig({ seed: 5, ignitionLambdaPerMin: 1 }))
    r.stepTicks(300)
    const a = r.getStoreSnapshot().score.fireMinutes
    r.reconfigure({}) // same config -> same seed -> identical replay
    r.stepTicks(300)
    const b = r.getStoreSnapshot().score.fireMinutes
    expect(b).toBe(a)
    expect(a).toBeGreaterThan(0)
  })

  it('applies config overrides (fleet size)', () => {
    const r = new SimRunner(makeConfig())
    r.reconfigure({ dronesPerBase: 3 })
    expect(r.getStoreSnapshot().drones.length).toBe(12)
  })

  it('exposes a per-drone blackout schedule', () => {
    const r = new SimRunner(makeConfig())
    const bo = r.getBlackout('redding-1')
    expect(bo).not.toBeNull()
    expect(bo!.windows.length).toBeGreaterThan(0)
    expect(r.getBlackout('nope')).toBeNull()
  })
})
