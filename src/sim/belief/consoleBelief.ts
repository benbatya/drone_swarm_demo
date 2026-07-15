import type { Directive, ScanOrientation } from '../directives/types'
import type { CellId, Vec2 } from '../geo'
import type { DroneStatus } from '../drones/drone'
import type { KnownFire } from './droneBelief'

/** The telemetry the console last received from a drone. */
export interface ReportedState {
  pos: Vec2
  heading: number
  fuelL: number
  retardant: number
  status: DroneStatus
  forcedRtb: boolean
  currentDirectiveKind: string | null
  queueLen: number
  /** Was the drone flying its sweep at last contact? Drives sweep dead-reckoning. */
  scanning: boolean
  /** Sweep direction at last contact, to reconstruct the lawnmower path. */
  scanOrientation: ScanOrientation
  /** Running total of fires the drone has extinguished, as of last contact. */
  extinguishedTotal: number
}

export interface PendingDirective {
  directive: Directive
  issuedAt: number
  downloadedAt: number | null
}

export interface ConsoleDroneRecord {
  id: string
  lastContactAt: number | null
  reported: ReportedState | null
  pending: PendingDirective[]
}

/** A fire the console has been told a drone extinguished. */
export interface ExtinguishedFire {
  cellId: CellId
  extinguishedAt: number
  extinguishedBy: string
}

/**
 * The console's believed state — updated ONLY by the comms sync path and by
 * operator input (addPending). Never reads ground truth directly.
 */
export interface ConsoleBelief {
  drones: Map<string, ConsoleDroneRecord>
  fires: Map<CellId, KnownFire>
  /** Cells drones have reported extinguishing (keyed by cell; latest report wins). */
  extinguished: Map<CellId, ExtinguishedFire>
}

export function makeConsoleBelief(ids: string[]): ConsoleBelief {
  const drones = new Map<string, ConsoleDroneRecord>()
  for (const id of ids) {
    drones.set(id, { id, lastContactAt: null, reported: null, pending: [] })
  }
  return { drones, fires: new Map(), extinguished: new Map() }
}

/** Operator input: queue a pending directive for a drone (downloaded at sync). */
export function addPending(
  cb: ConsoleBelief,
  droneId: string,
  directive: Directive,
  issuedAt: number,
): void {
  const rec = cb.drones.get(droneId)
  if (!rec) return
  rec.pending.push({ directive, issuedAt, downloadedAt: null })
}
