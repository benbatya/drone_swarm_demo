import { dayOf, hourMinOf } from './clock'
import { cellCenter, metersToLngLat } from './geo'
import type { CellId } from './geo'
import { activeKnownCount } from './belief/droneBelief'
import type { DroneStatus, DroneTruth } from './drones/drone'
import type { GroundTruth } from './world'

// Render-facing view of the world. Rebuilt each frame; flat and lng/lat-based
// so deck.gl layers can consume it directly. Carries BOTH the ground-truth view
// (God Mode) and the console-belief view (User Console).

export type DroneMode =
  | 'patrol'
  | 'scan'
  | 'extinguish'
  | 'rtb'
  | 'forced-rtb'
  | 'docked'
  | 'crashed'

export interface DroneView {
  id: string
  homeBaseId: string
  position: [number, number]
  heading: number
  status: DroneStatus
  mode: DroneMode
  fuelL: number
  fuelFrac: number
  retardant: number
  knownCount: number
  queueLen: number
  currentDirectiveKind: string | null
  forcedRtb: boolean
  dockRemainingMin: number
  crashedAt: number | null
}

export interface FireView {
  cellId: CellId
  position: [number, number]
  ignitedAt: number
}

export type Staleness = 'unknown' | 'fresh' | 'stale' | 'missing'

export interface ConsoleDroneView {
  id: string
  homeBaseId: string
  staleness: Staleness
  lastContactAt: number | null
  contactAgeMin: number | null
  /** Last confirmed (reported) position, or null if never contacted. */
  reportedPosition: [number, number] | null
  heading: number | null
  /** Dead-reckoned ghost; equals reported for fresh/missing, extrapolated when stale. */
  ghostPosition: [number, number] | null
  uncertaintyRadiusM: number
  status: DroneStatus | null
  fuelL: number | null
  retardant: number | null
  forcedRtb: boolean
  currentDirectiveKind: string | null
  queueLen: number
  pendingCount: number
  downloadedCount: number
}

export interface ConsoleView {
  drones: ConsoleDroneView[]
  fires: FireView[]
}

export interface TruthSnapshot {
  version: number
  tick: number
  day: number
  hourMin: string
  running: boolean
  speed: number
  score: {
    fireMinutes: number
    totalFires: number
    doused: number
    activeFires: number
  }
  drones: DroneView[]
  fires: FireView[]
  console: ConsoleView
}

export interface SnapshotMeta {
  running: boolean
  speed: number
  version: number
}

function modeOf(d: DroneTruth): DroneMode {
  if (d.status === 'crashed') return 'crashed'
  if (d.status === 'docked') return 'docked'
  if (d.override) return 'forced-rtb'
  if (d.exec) return d.exec.kind
  if (d.autoExec) return 'extinguish'
  return 'patrol'
}

function firesToViews(fires: Iterable<{ cellId: CellId; ignitedAt?: number; firstSeenAt?: number }>): FireView[] {
  const out: FireView[] = []
  for (const f of fires) {
    const c = cellCenter(f.cellId)
    const ll = metersToLngLat(c.x, c.y)
    out.push({
      cellId: f.cellId,
      position: [ll.lng, ll.lat],
      ignitedAt: f.ignitedAt ?? f.firstSeenAt ?? 0,
    })
  }
  return out
}

function buildConsoleView(w: GroundTruth): ConsoleView {
  const cfg = w.cfg
  const now = w.tick
  const drones: ConsoleDroneView[] = []

  for (const rec of w.console.drones.values()) {
    const homeBaseId = rec.id.replace(/-\d+$/, '')
    const pendingCount = rec.pending.length
    const downloadedCount = rec.pending.filter((p) => p.downloadedAt != null).length

    if (!rec.reported || rec.lastContactAt == null) {
      drones.push({
        id: rec.id,
        homeBaseId,
        staleness: 'unknown',
        lastContactAt: null,
        contactAgeMin: null,
        reportedPosition: null,
        heading: null,
        ghostPosition: null,
        uncertaintyRadiusM: 0,
        status: null,
        fuelL: null,
        retardant: null,
        forcedRtb: false,
        currentDirectiveKind: null,
        queueLen: 0,
        pendingCount,
        downloadedCount,
      })
      continue
    }

    const age = now - rec.lastContactAt
    const staleness: Staleness =
      age > cfg.missingThresholdMin
        ? 'missing'
        : age > cfg.staleThresholdMin
          ? 'stale'
          : 'fresh'

    const rep = rec.reported
    const reportedLL = metersToLngLat(rep.pos.x, rep.pos.y)

    // Dead reckoning: extrapolate along last heading while stale; freeze on missing.
    let ghostX = rep.pos.x
    let ghostY = rep.pos.y
    let uncertaintyRadiusM = 0
    if (staleness === 'stale' && rep.status === 'airborne') {
      const dist = cfg.speedMPerMin * age
      ghostX = rep.pos.x + Math.sin(rep.heading) * dist
      ghostY = rep.pos.y + Math.cos(rep.heading) * dist
      uncertaintyRadiusM = cfg.speedMPerMin * age * 0.25
    }
    const ghostLL = metersToLngLat(ghostX, ghostY)

    drones.push({
      id: rec.id,
      homeBaseId,
      staleness,
      lastContactAt: rec.lastContactAt,
      contactAgeMin: age,
      reportedPosition: [reportedLL.lng, reportedLL.lat],
      heading: rep.heading,
      ghostPosition: [ghostLL.lng, ghostLL.lat],
      uncertaintyRadiusM,
      status: rep.status,
      fuelL: rep.fuelL,
      retardant: rep.retardant,
      forcedRtb: rep.forcedRtb,
      currentDirectiveKind: rep.currentDirectiveKind,
      queueLen: rep.queueLen,
      pendingCount,
      downloadedCount,
    })
  }

  const fires: FireView[] = []
  for (const kf of w.console.fires.values()) {
    if (kf.believedOut) continue
    const c = cellCenter(kf.cellId)
    const ll = metersToLngLat(c.x, c.y)
    fires.push({ cellId: kf.cellId, position: [ll.lng, ll.lat], ignitedAt: kf.firstSeenAt })
  }

  return { drones, fires }
}

export function buildSnapshot(w: GroundTruth, meta: SnapshotMeta): TruthSnapshot {
  const drones: DroneView[] = w.drones.map((d) => {
    const ll = metersToLngLat(d.pos.x, d.pos.y)
    return {
      id: d.id,
      homeBaseId: d.homeBaseId,
      position: [ll.lng, ll.lat],
      heading: d.heading,
      status: d.status,
      mode: modeOf(d),
      fuelL: d.fuelL,
      fuelFrac: d.fuelL / w.cfg.fuelCapacityL,
      retardant: d.retardant,
      knownCount: activeKnownCount(d.belief),
      queueLen: d.queue.length,
      currentDirectiveKind: d.queue[0]?.kind ?? null,
      forcedRtb: d.forcedRtb,
      dockRemainingMin: d.dockRemainingMin,
      crashedAt: d.crashedAt ?? null,
    }
  })

  return {
    version: meta.version,
    tick: w.tick,
    day: dayOf(w.tick),
    hourMin: hourMinOf(w.tick),
    running: meta.running,
    speed: meta.speed,
    score: {
      fireMinutes: w.score.fireMinutes,
      totalFires: w.score.totalFires,
      doused: w.score.doused,
      activeFires: w.fires.size,
    },
    drones,
    fires: firesToViews(w.fires.values()),
    console: buildConsoleView(w),
  }
}
