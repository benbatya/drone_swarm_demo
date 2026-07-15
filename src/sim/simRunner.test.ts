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

  it('playAtSpeed unpauses at the chosen speed', () => {
    const r = new SimRunner(makeConfig())
    expect(r.isRunning()).toBe(false)
    r.playAtSpeed(180)
    expect(r.isRunning()).toBe(true)
    expect(r.getSpeed()).toBe(180)
  })

  it('playAtSpeed changes speed while already running', () => {
    const r = new SimRunner(makeConfig())
    r.playAtSpeed(30)
    r.playAtSpeed(960)
    expect(r.isRunning()).toBe(true)
    expect(r.getSpeed()).toBe(960)
  })

  it('pause halts the sim but leaves the selected speed intact', () => {
    const r = new SimRunner(makeConfig())
    r.playAtSpeed(480)
    r.pause()
    expect(r.isRunning()).toBe(false)
    expect(r.getSpeed()).toBe(480) // so the UI keeps highlighting Paused, not a speed
  })

  it('exposes a per-drone blackout schedule', () => {
    const r = new SimRunner(makeConfig())
    const bo = r.getBlackout('redding-1')
    expect(bo).not.toBeNull()
    expect(bo!.windows.length).toBeGreaterThan(0)
    expect(r.getBlackout('nope')).toBeNull()
  })
})
