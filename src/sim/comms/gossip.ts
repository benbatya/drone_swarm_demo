import { distance } from '../geo'
import type { GroundTruth } from '../world'
import { mergeFireMap } from './merge'

/**
 * Drone↔drone gossip: every pair of airborne drones within gossipRangeM
 * exchanges fire beliefs both ways. Unaffected by console blackouts — this is
 * the intra-swarm mesh that heals knowledge independently of the C2 link.
 */
export function stepGossip(w: GroundTruth): void {
  const ds = w.drones.filter((d) => d.status === 'airborne')
  const R = w.cfg.gossipRangeM
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      if (distance(ds[i].pos, ds[j].pos) <= R) {
        const a = ds[i].belief.fires
        const b = ds[j].belief.fires
        const aSnapshot = new Map(a) // pre-merge view of A, for symmetric exchange
        mergeFireMap(a, b, 'gossip')
        mergeFireMap(b, aSnapshot, 'gossip')
      }
    }
  }
}
