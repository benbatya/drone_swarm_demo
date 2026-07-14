import { describe, expect, it } from 'vitest'
import { makeConfig } from './config'

describe('SimConfig fuel model', () => {
  it('derives a burn rate consistent with the operational range', () => {
    const cfg = makeConfig()
    expect(cfg.fuelBurnLPerMin).toBeCloseTo(5.6, 6)
    // A full tank flown straight covers exactly operationalRangeKm.
    const minutesAloft = cfg.fuelCapacityL / cfg.fuelBurnLPerMin
    const rangeKm = (minutesAloft * cfg.speedMPerMin) / 1000
    expect(rangeKm).toBeCloseTo(cfg.operationalRangeKm, 3)
  })

  it('keeps range/burn consistent when retuned', () => {
    const cfg = makeConfig({ operationalRangeKm: 450, fuelCapacityL: 800 })
    const minutesAloft = cfg.fuelCapacityL / cfg.fuelBurnLPerMin
    const rangeKm = (minutesAloft * cfg.speedMPerMin) / 1000
    expect(rangeKm).toBeCloseTo(450, 3)
  })
})
