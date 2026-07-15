import type { SimConfig } from '../config'
import type { ConsoleBelief, ConsoleDroneRecord } from '../belief/consoleBelief'
import { enqueue } from '../directives/queue'
import { isScanning, type DroneTruth } from '../drones/drone'
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
    scanning: isScanning(d),
    scanOrientation: d.scanOrientation,
    extinguishedTotal: d.extinguishedTotal,
  }
}

/** Upload the drone's fire-belief delta (entries touched since last sync). */
function uploadFires(cb: ConsoleBelief, d: DroneTruth, sinceTick: number): void {
  for (const f of d.belief.fires.values()) {
    if (f.updatedAt > sinceTick) mergeFire(cb.fires, { ...f, source: 'console' })
  }
}

/** Upload the cells the drone extinguished since last sync into the console's
 * extinguished-fire log (keyed by cell; the latest report wins). */
function uploadDoused(cb: ConsoleBelief, d: DroneTruth): void {
  for (const e of d.dousedSinceSync) {
    cb.extinguished.set(e.cellId, {
      cellId: e.cellId,
      extinguishedAt: e.at,
      extinguishedBy: d.id,
    })
  }
}

/** Prune pending directives the drone has since completed or aborted. */
function reconcilePending(rec: ConsoleDroneRecord, d: DroneTruth): void {
  const live = new Set(d.queue.map((x) => x.id))
  rec.pending = rec.pending.filter(
    (p) => p.downloadedAt == null || live.has(p.directive.id),
  )
  d.abortedIds.length = 0 // reported and consumed
  d.dousedSinceSync.length = 0 // reported and consumed
}

function download(rec: ConsoleDroneRecord, d: DroneTruth, now: number, cfg: SimConfig): void {
  for (const p of rec.pending) {
    if (p.downloadedAt == null) {
      enqueue(d, p.directive, cfg)
      p.downloadedAt = now
    }
  }
}

/**
 * Drone-initiated sync. At nextSyncAt a drone attempts to reach the console:
 * docked drones are hard-lined (always connected); airborne drones succeed only
 * outside a dark window. On success it uploads telemetry + fire delta, the
 * console prunes completed/aborted pendings and the drone downloads new ones,
 * then the +32-min cadence resumes. On a blacked-out attempt it re-polls every
 * syncRetryMin minutes until the link returns.
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
      // Blacked out at the attempt: re-poll at a short constant interval so the
      // drone reconnects within ~syncRetryMin of the link returning and never
      // sleeps through a connected window. (A decreasing/halving backoff would
      // skip connected windows and let routine outages stack past the missing
      // threshold — see missingThresholdMin sizing.)
      c.retryIntervalMin = cfg.syncRetryMin
      c.nextSyncAt = now + cfg.syncRetryMin
      continue
    }

    const rec = w.console.drones.get(d.id)
    if (rec) {
      uploadTelemetry(rec, d, now)
      uploadFires(w.console, d, c.lastSyncAt)
      uploadDoused(w.console, d)
      reconcilePending(rec, d)
      download(rec, d, now, cfg)
    }
    c.lastSyncAt = now
    c.retryIntervalMin = 0
    c.nextSyncAt = now + cfg.syncCadenceMin
  }
}
