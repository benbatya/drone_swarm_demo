import { BASES, WORLD_H_M, WORLD_W_M, type SimConfig } from './config'
import { cellIdOf, distance, lngLatToMeters, type CellId, type Vec2 } from './geo'
import type { Rng } from './rng'

export interface FireTruth {
  cellId: CellId
  ignitedAt: number
  extinguishedAt?: number
  extinguishedBy?: string
}

const BASE_METERS: Vec2[] = BASES.map((b) => lngLatToMeters(b.lng, b.lat))

/**
 * Sample Poisson(λ) new ignitions for this tick. Cells within `baseExclusionM`
 * of a base or already burning are rejected. Returns the number actually added.
 */
export function stepIgnition(
  rng: Rng,
  fires: Map<CellId, FireTruth>,
  now: number,
  cfg: SimConfig,
): number {
  const n = rng.poisson(cfg.ignitionLambdaPerMin)
  let added = 0
  for (let i = 0; i < n; i++) {
    const p: Vec2 = { x: rng.range(0, WORLD_W_M), y: rng.range(0, WORLD_H_M) }
    const id = cellIdOf(p)
    if (fires.has(id)) continue
    let tooClose = false
    for (const bm of BASE_METERS) {
      if (distance(p, bm) < cfg.baseExclusionM) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue
    fires.set(id, { cellId: id, ignitedAt: now })
    added++
  }
  return added
}
