import { describe, expect, it } from 'vitest'
import { BASES, WORLD_H_M, WORLD_W_M, makeConfig } from './config'
import { cellCenter, distance, lngLatToMeters } from './geo'
import { stepIgnition, type FireTruth } from './ignition'
import { isOnLand } from './land'
import { makeRng } from './rng'
import type { CellId } from './geo'

describe('ignition', () => {
  it('never ignites within the base exclusion radius', () => {
    const cfg = makeConfig({ ignitionLambdaPerMin: 5 })
    const rng = makeRng(42)
    const fires = new Map<CellId, FireTruth>()
    for (let t = 1; t <= 3000; t++) stepIgnition(rng, fires, t, cfg)

    expect(fires.size).toBeGreaterThan(100)

    const baseMeters = BASES.map((b) => lngLatToMeters(b.lng, b.lat))
    for (const f of fires.values()) {
      const c = cellCenter(f.cellId)
      for (const bm of baseMeters) {
        // Exclusion tests the random point; the cell center is within ~10m of it.
        expect(distance(c, bm)).toBeGreaterThan(cfg.baseExclusionM - 15)
      }
    }
  })

  it('keeps every fire within the map bounds', () => {
    const cfg = makeConfig({ ignitionLambdaPerMin: 5 })
    const rng = makeRng(7)
    const fires = new Map<CellId, FireTruth>()
    for (let t = 1; t <= 3000; t++) stepIgnition(rng, fires, t, cfg)
    expect(fires.size).toBeGreaterThan(100)
    for (const f of fires.values()) {
      const c = cellCenter(f.cellId)
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThanOrEqual(WORLD_W_M)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeLessThanOrEqual(WORLD_H_M)
    }
  })

  it('only ignites fires on land, never in the ocean', () => {
    const cfg = makeConfig({ ignitionLambdaPerMin: 5 })
    const rng = makeRng(13)
    const fires = new Map<CellId, FireTruth>()
    for (let t = 1; t <= 3000; t++) stepIgnition(rng, fires, t, cfg)
    expect(fires.size).toBeGreaterThan(100)
    for (const f of fires.values()) {
      expect(isOnLand(cellCenter(f.cellId))).toBe(true)
    }
  })

  it('is deterministic for a fixed seed', () => {
    const cfg = makeConfig({ ignitionLambdaPerMin: 2 })
    const run = () => {
      const rng = makeRng(101)
      const fires = new Map<CellId, FireTruth>()
      for (let t = 1; t <= 500; t++) stepIgnition(rng, fires, t, cfg)
      return [...fires.keys()].sort((a, b) => a - b)
    }
    expect(run()).toEqual(run())
  })
})
