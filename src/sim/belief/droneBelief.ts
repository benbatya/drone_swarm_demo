import type { CellId } from '../geo'

export type FireSource = 'self' | 'gossip' | 'console'

/** A drone's (or the console's) belief about one fire. */
export interface KnownFire {
  cellId: CellId
  firstSeenAt: number
  source: FireSource
  believedOut: boolean
  updatedAt: number
}

export interface DroneBelief {
  fires: Map<CellId, KnownFire>
}

export function makeDroneBelief(): DroneBelief {
  return { fires: new Map() }
}

/** Count of fires the belief currently holds as active (not believed out). */
export function activeKnownCount(b: DroneBelief): number {
  let n = 0
  for (const f of b.fires.values()) if (!f.believedOut) n++
  return n
}
