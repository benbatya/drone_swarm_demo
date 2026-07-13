import { describe, expect, it } from 'vitest'
import { makeConfig, TICKS_PER_SEASON } from './config'
import { makeRng } from './rng'
import { createWorld, tickWorld, type GroundTruth } from './world'

function runSeason(seed: number, ticks: number): GroundTruth {
  const cfg = makeConfig({ seed })
  const w = createWorld(cfg)
  const rng = makeRng(cfg.seed)
  let prevFireMinutes = 0
  for (let t = 0; t < ticks; t++) {
    tickWorld(w, rng)
    if (t % 2000 === 0) {
      // fire-minutes is monotonic non-decreasing
      expect(w.score.fireMinutes).toBeGreaterThanOrEqual(prevFireMinutes)
      prevFireMinutes = w.score.fireMinutes
      for (const d of w.drones) {
        expect(Number.isFinite(d.pos.x)).toBe(true)
        expect(Number.isFinite(d.pos.y)).toBe(true)
        expect(d.fuelL).toBeGreaterThanOrEqual(0)
        expect(d.fuelL).toBeLessThanOrEqual(cfg.fuelCapacityL)
      }
    }
  }
  return w
}

describe('world season', () => {
  it(
    'runs a full 43,200-tick season deterministically without NaN',
    () => {
      const a = runSeason(7, TICKS_PER_SEASON)
      const b = runSeason(7, TICKS_PER_SEASON)
      expect(a.score.fireMinutes).toBe(b.score.fireMinutes)
      expect(a.score.totalFires).toBe(b.score.totalFires)
      expect(a.fires.size).toBe(b.fires.size)
      expect(Number.isNaN(a.score.fireMinutes)).toBe(false)
      expect(a.score.fireMinutes).toBeGreaterThan(0)
    },
    60_000,
  )

  it('detects fires within range as drones patrol', () => {
    const cfg = makeConfig({ seed: 3, ignitionLambdaPerMin: 1 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    for (let t = 0; t < 2000; t++) tickWorld(w, rng)
    const totalKnown = w.drones.reduce((n, d) => n + d.knownFires.size, 0)
    expect(totalKnown).toBeGreaterThan(0)
  }, 20_000)

  it('autonomously douses fires and keeps most of the fleet airborne', () => {
    const cfg = makeConfig({ seed: 11 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    for (let t = 0; t < TICKS_PER_SEASON; t++) tickWorld(w, rng)

    // The fleet self-assigns extinguishes and actually puts fires out.
    expect(w.score.doused).toBeGreaterThan(0)
    // RTB refueling keeps the fleet alive — not everyone crashes.
    const alive = w.drones.filter((d) => d.status !== 'crashed').length
    expect(alive).toBeGreaterThan(0)
    // Retardant/fuel invariants hold at season end.
    for (const d of w.drones) {
      expect(d.retardant).toBeGreaterThanOrEqual(0)
      expect(d.retardant).toBeLessThanOrEqual(cfg.retardantLoads)
    }
  }, 60_000)
})

describe('crash on fuel exhaustion', () => {
  it('crashes a drone that runs out of fuel and freezes it forever', () => {
    const cfg = makeConfig()
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    const d = w.drones[0]

    // Strand it far from home with essentially no fuel so it can't refuel.
    d.pos = { x: d.homePos.x + 10_000, y: d.homePos.y }
    d.fuelL = 1

    tickWorld(w, rng)
    expect(d.status).toBe('crashed')
    expect(d.fuelL).toBe(0)
    expect(d.crashedAt).toBe(w.tick)

    const frozen = { x: d.pos.x, y: d.pos.y }
    for (let i = 0; i < 10; i++) tickWorld(w, rng)
    expect(d.pos).toEqual(frozen)
    expect(d.status).toBe('crashed')
    expect(d.knownFires.size).toBe(0) // no detection after crash
  })
})
