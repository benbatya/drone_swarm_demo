import type { CellId } from '../geo'
import type { KnownFire } from '../belief/droneBelief'

/**
 * Merge one KnownFire into a fire map. Rules (idempotent + commutative):
 *   - dedupe by cellId
 *   - believedOut is monotonic (out-wins)
 *   - otherwise newest updatedAt wins (source follows the newest)
 *   - firstSeenAt keeps the earliest
 * Ties on updatedAt keep the existing entry's source (deterministic).
 */
export function mergeFire(target: Map<CellId, KnownFire>, incoming: KnownFire): void {
  const cur = target.get(incoming.cellId)
  if (!cur) {
    target.set(incoming.cellId, { ...incoming })
    return
  }
  const incomingNewer = incoming.updatedAt > cur.updatedAt
  target.set(incoming.cellId, {
    cellId: cur.cellId,
    firstSeenAt: Math.min(cur.firstSeenAt, incoming.firstSeenAt),
    source: incomingNewer ? incoming.source : cur.source,
    believedOut: cur.believedOut || incoming.believedOut,
    updatedAt: Math.max(cur.updatedAt, incoming.updatedAt),
  })
}

/** Merge all entries of `src` into `dst`, optionally retagging the source. */
export function mergeFireMap(
  dst: Map<CellId, KnownFire>,
  src: Map<CellId, KnownFire>,
  sourceOverride?: KnownFire['source'],
): void {
  for (const f of src.values()) {
    mergeFire(dst, sourceOverride ? { ...f, source: sourceOverride } : f)
  }
}
