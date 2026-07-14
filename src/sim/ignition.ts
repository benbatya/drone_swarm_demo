import { BASES, CELL_SIZE_M, WORLD_H_M, WORLD_W_M, type SimConfig } from './config'
import { cellCenter, cellIdOf, distance, lngLatToMeters, type CellId, type Vec2 } from './geo'
import { isOnLand } from './land'
import type { Rng } from './rng'

export interface FireTruth {
  cellId: CellId
  ignitedAt: number
  extinguishedAt?: number
  extinguishedBy?: string
}

const BASE_METERS: Vec2[] = BASES.map((b) => lngLatToMeters(b.lng, b.lat))

/**
 * Sample Poisson(λ) new ignitions for this tick. Cells in the ocean/water,
 * within `baseExclusionM` of a base, or already burning are rejected. Returns
 * the number actually added.
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
    // Sample a cell fully inside the world: the last partial cell would round a
    // cell center just past the edge, so keep a one-cell margin.
    const p: Vec2 = {
      x: rng.range(0, WORLD_W_M - CELL_SIZE_M),
      y: rng.range(0, WORLD_H_M - CELL_SIZE_M),
    }
    const id = cellIdOf(p)
    if (fires.has(id)) continue
    // Fires only start on land — reject ocean/water cells. Test the cell's
    // center (what actually burns), so the stored fire is definitively on land.
    if (!isOnLand(cellCenter(id))) continue
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
