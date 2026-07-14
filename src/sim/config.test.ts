import { describe, expect, it } from 'vitest'
import { makeConfig } from './config'

describe('SimConfig fuel model', () => {
  it('uses a fixed burn rate; endurance follows from capacity', () => {
    const cfg = makeConfig()
    expect(cfg.fuelBurnLPerMin).toBeCloseTo(2.8, 6)
    // A full 2000 L tank flown straight covers ~1200 km.
    const minutesAloft = cfg.fuelCapacityL / cfg.fuelBurnLPerMin
    const rangeKm = (minutesAloft * cfg.speedMPerMin) / 1000
    expect(rangeKm).toBeCloseTo(1200, 0)
  })

  it('keeps the burn rate fixed when capacity is retuned', () => {
    const cfg = makeConfig({ fuelCapacityL: 800 })
    expect(cfg.fuelBurnLPerMin).toBeCloseTo(2.8, 6)
    // Halving-ish the tank shortens endurance proportionally, burn unchanged.
    const minutesAloft = cfg.fuelCapacityL / cfg.fuelBurnLPerMin
    expect(minutesAloft).toBeCloseTo(800 / 2.8, 3)
  })
})
