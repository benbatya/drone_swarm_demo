import type { ConsoleBelief, ConsoleDroneRecord } from '../belief/consoleBelief'
import { enqueue } from '../directives/queue'
import type { DroneTruth } from '../drones/drone'
import type { GroundTruth } from '../world'
import { isDarkAt } from './blackout'
import { mergeFire } from './merge'

function uploadTelemetry(rec: ConsoleDroneRecord, d: DroneTruth, now: number): void {
  rec.lastContactAt = now
  rec.reported = {
    pos: { x: d.pos.x, y: d.pos.y },
    heading: d.heading,
    fuelL: d.fuelL,
    retardant: d.retardant,
    status: d.status,
    forcedRtb: d.forcedRtb,
    currentDirectiveKind: d.queue[0]?.kind ?? null,
    queueLen: d.queue.length,
  }
}

/** Upload the drone's fire-belief delta (entries touched since last sync). */
function uploadFires(cb: ConsoleBelief, d: DroneTruth, sinceTick: number): void {
  for (const f of d.belief.fires.values()) {
    if (f.updatedAt > sinceTick) mergeFire(cb.fires, { ...f, source: 'console' })
  }
}

/** Prune pending directives the drone has since completed or aborted. */
function reconcilePending(rec: ConsoleDroneRecord, d: DroneTruth): void {
  const live = new Set(d.queue.map((x) => x.id))
  rec.pending = rec.pending.filter(
    (p) => p.downloadedAt == null || live.has(p.directive.id),
  )
  d.abortedIds.length = 0 // reported and consumed
}

function download(rec: ConsoleDroneRecord, d: DroneTruth, now: number): void {
  for (const p of rec.pending) {
    if (p.downloadedAt == null) {
      enqueue(d, p.directive)
      p.downloadedAt = now
    }
  }
}

/**
 * Drone-initiated sync. At nextSyncAt a drone attempts to reach the console:
 * docked drones are hard-lined (always connected); airborne drones succeed only
 * outside a dark window. On success it uploads telemetry + fire delta, the
 * console prunes completed/aborted pendings and the drone downloads new ones,
 * then the +32-min cadence resumes. On failure the retry interval halves
 * (16→8→4→2→1) until it succeeds.
 */
export function stepSync(w: GroundTruth): void {
  const now = w.tick
  const cfg = w.cfg
  for (const d of w.drones) {
    if (d.status === 'crashed') continue // permanently no comms
    const c = d.comms
    // A docked drone is hard-lined at base: always reachable, and it refreshes
    // the console every tick (bypassing the cadence) so it can never drift
    // stale/missing while it's sitting at a base — at base ⇒ never blacked out.
    const docked = d.status === 'docked'
    if (!docked && now < c.nextSyncAt) continue

    const connected = docked || !isDarkAt(c, now)
    if (!connected) {
      c.retryIntervalMin =
        c.retryIntervalMin === 0
          ? cfg.syncRetryStartMin
          : Math.max(1, Math.floor(c.retryIntervalMin / 2))
      c.nextSyncAt = now + c.retryIntervalMin
      continue
    }

    const rec = w.console.drones.get(d.id)
    if (rec) {
      uploadTelemetry(rec, d, now)
      uploadFires(w.console, d, c.lastSyncAt)
      reconcilePending(rec, d)
      download(rec, d, now)
    }
    c.lastSyncAt = now
    c.retryIntervalMin = 0
    c.nextSyncAt = now + cfg.syncCadenceMin
  }
}
