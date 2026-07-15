import { describe, expect, it } from 'vitest'
import { makeConfig } from '../config'
import {
  buildLawnmower,
  headingAtDistance,
  nearestArcLength,
  pathLength,
  pointAtDistance,
  sweepSpacingM,
} from '../directives/scanExec'
import { scanSectorFor } from '../drones/scanSectors'
import { lngLatToMeters } from '../geo'
import { makeRng } from '../rng'
import { buildSnapshot } from '../snapshot'
import { createWorld, tickWorld, type GroundTruth } from '../world'
import type { DroneCommsState } from './blackout'
import { generateDarkWindows } from './blackout'
import { stepGossip } from './gossip'
import { stepSync } from './sync'

const cfg0 = () => makeConfig({ ignitionLambdaPerMin: 0 })
const alwaysDark = (): DroneCommsState['darkWindows'] => [
  { startMin: 0, endMin: 1_000_000, deep: true },
]

describe('blackout generation', () => {
  it('lands the dark fraction in the 40–60% target and shows both window types', () => {
    const cfg = makeConfig()
    const horizon = 200_000
    const wins = generateDarkWindows(makeRng(9), horizon, cfg)
    const dark = wins.reduce((s, w) => s + (w.endMin - w.startMin), 0)
    const frac = dark / horizon
    expect(frac).toBeGreaterThan(0.4)
    expect(frac).toBeLessThan(0.6)

    const routine = wins.filter((w) => !w.deep)
    const deep = wins.filter((w) => w.deep)
    expect(routine.length).toBeGreaterThan(0)
    expect(deep.length).toBeGreaterThan(0)
    // Routine windows stay within their bound (≤40 min) — too short, on their
    // own, to reach the missing threshold.
    for (const w of routine) expect(w.endMin - w.startMin).toBeLessThanOrEqual(cfg.routineDarkMaxMin)
    // Deep outages exceed the missing threshold, so they alone can trip MISSING.
    for (const w of deep) expect(w.endMin - w.startMin).toBeGreaterThan(cfg.missingThresholdMin)
  })
})

describe('sync', () => {
  it('syncs on the 32-min cadence when always connected', () => {
    const w = createWorld(cfg0())
    const d = w.drones[0]
    d.comms.darkWindows = [] // never dark
    d.comms.nextSyncAt = 1
    d.comms.lastSyncAt = -Infinity
    const rng = makeRng(1)
    const syncTicks: number[] = []
    let prev = d.comms.lastSyncAt
    for (let t = 0; t < 70; t++) {
      tickWorld(w, rng)
      if (d.comms.lastSyncAt !== prev) {
        syncTicks.push(d.comms.lastSyncAt)
        prev = d.comms.lastSyncAt
      }
    }
    expect(syncTicks).toEqual([1, 33, 65])
    // Console received telemetry.
    const rec = w.console.drones.get(d.id)!
    expect(rec.reported).not.toBeNull()
    expect(rec.lastContactAt).toBe(65)
  })

  it('re-polls at a constant 3-min retry interval while dark', () => {
    const w = createWorld(cfg0())
    const d = w.drones[0]
    d.comms.darkWindows = alwaysDark()
    d.comms.cursor = 0
    d.comms.nextSyncAt = 1
    d.comms.lastSyncAt = -Infinity
    const rng = makeRng(1)
    const deltas: number[] = []
    let prev = d.comms.nextSyncAt
    for (let t = 0; t < 45; t++) {
      tickWorld(w, rng)
      if (d.comms.nextSyncAt !== prev) {
        deltas.push(d.comms.nextSyncAt - w.tick)
        prev = d.comms.nextSyncAt
      }
    }
    // Constant re-poll: every failed attempt reschedules exactly syncRetryMin (3)
    // minutes out — no decreasing backoff that could skip a connected window.
    expect(deltas.slice(0, 6)).toEqual([3, 3, 3, 3, 3, 3])
    // Never contacted the console.
    expect(w.console.drones.get(d.id)!.reported).toBeNull()
  })

  it('keeps a docked drone in contact every tick despite a scheduled blackout', () => {
    // At base a drone is hard-lined: even in a permanent dark window, and even
    // when a sync is not "due", it refreshes the console every tick so it can
    // never drift stale/missing while sitting at a base.
    const w = createWorld(cfg0())
    const d = w.drones[0]
    d.comms.darkWindows = alwaysDark()
    d.comms.cursor = 0
    d.comms.nextSyncAt = 999_999 // far from due
    d.comms.lastSyncAt = -Infinity
    d.status = 'docked'
    for (const t of [5, 6, 7]) {
      w.tick = t
      stepSync(w)
      expect(w.console.drones.get(d.id)!.lastContactAt).toBe(t)
    }
  })
})

describe('gossip', () => {
  it('shares fire knowledge between in-range airborne drones', () => {
    const w = createWorld(cfg0())
    const [a, b] = w.drones
    a.pos = { x: 100_000, y: 100_000 }
    b.pos = { x: 110_000, y: 100_000 } // 10km apart, within 50km
    a.belief.fires.set(500, {
      cellId: 500,
      firstSeenAt: 1,
      source: 'self',
      believedOut: false,
      updatedAt: 1,
    })
    expect(b.belief.fires.has(500)).toBe(false)
    stepGossip(w)
    expect(b.belief.fires.get(500)?.source).toBe('gossip')
  })
})

describe('belief isolation', () => {
  it('never mutates ConsoleBelief without a successful sync', () => {
    // All links dark and all drones airborne (short run, no fuel dock — docked
    // drones are hard-lined and would legitimately sync). The console can only
    // change via the sync path, so it must stay empty.
    const w = createWorld(cfg0())
    w.drones.forEach((d, i) => {
      d.comms.darkWindows = alwaysDark()
      d.comms.cursor = 0
      d.comms.nextSyncAt = 1
      d.comms.lastSyncAt = -Infinity
      d.belief.fires.set(1000 + i, {
        cellId: 1000 + i,
        firstSeenAt: 1,
        source: 'self',
        believedOut: false,
        updatedAt: 1,
      })
    })
    const rng = makeRng(4)
    for (let t = 0; t < 50; t++) tickWorld(w, rng)
    expect(w.drones.every((d) => d.status === 'airborne')).toBe(true)

    const totalBelief = w.drones.reduce((n, d) => n + d.belief.fires.size, 0)
    expect(totalBelief).toBeGreaterThan(0)
    expect(w.console.fires.size).toBe(0)
    for (const rec of w.console.drones.values()) {
      expect(rec.reported).toBeNull()
      expect(rec.lastContactAt).toBeNull()
    }
  })
})

describe('extinguished-fire reporting', () => {
  it('uploads doused cells to the console at sync and surfaces them for rendering', () => {
    const w = createWorld(cfg0())
    const d = w.drones[0]
    d.comms.darkWindows = [] // always connected
    d.comms.nextSyncAt = 1
    d.comms.lastSyncAt = -Infinity
    // Two fires this drone extinguished since its last sync.
    d.dousedSinceSync = [
      { cellId: 4321, at: 3 },
      { cellId: 8765, at: 4 },
    ]
    d.extinguishedTotal = 2 // running total reported in telemetry
    w.tick = 5
    stepSync(w)

    // Console logged both, attributed to this drone.
    expect(w.console.extinguished.get(4321)).toMatchObject({
      cellId: 4321,
      extinguishedBy: d.id,
      extinguishedAt: 3,
    })
    expect(w.console.extinguished.get(8765)?.extinguishedBy).toBe(d.id)
    // Delta consumed so it isn't re-reported next sync.
    expect(d.dousedSinceSync).toEqual([])

    // Surfaced to the console view (what the User Console renders).
    const snap = buildSnapshot(w, { running: true, speed: 1, version: 1, seasonComplete: false })
    const cells = snap.console.extinguishedFires.map((e) => e.cellId)
    expect(cells).toContain(4321)
    expect(cells).toContain(8765)
    // Each extinguished marker carries the extinguishing drone's identity hue.
    const droneView = snap.console.drones.find((dv) => dv.id === d.id)!
    expect(snap.console.extinguishedFires.find((e) => e.cellId === 4321)!.hue).toBe(droneView.hue)
    // The drone's per-drone state shows its reported running extinguished total.
    expect(droneView.extinguishedCount).toBe(2)
  })

  it('does not report a doused cell while the drone is blacked out', () => {
    const w = createWorld(cfg0())
    const d = w.drones[0]
    d.comms.darkWindows = alwaysDark()
    d.comms.cursor = 0
    d.comms.nextSyncAt = 1
    d.comms.lastSyncAt = -Infinity
    d.dousedSinceSync = [{ cellId: 4321, at: 3 }]
    w.tick = 5
    stepSync(w)

    // No contact → nothing logged, and the delta is kept for the next sync.
    expect(w.console.extinguished.size).toBe(0)
    expect(d.dousedSinceSync).toHaveLength(1)
  })
})

describe('console staleness derivation', () => {
  function snapWithAge(age: number): GroundTruth {
    const w = createWorld(cfg0())
    const rec = w.console.drones.get('redding-1')!
    rec.reported = {
      pos: { x: 100_000, y: 100_000 },
      heading: 0,
      fuelL: 500,
      retardant: 5,
      status: 'airborne',
      forcedRtb: false,
      currentDirectiveKind: null,
      queueLen: 0,
      scanning: false,
      scanOrientation: 'horizontal',
      extinguishedTotal: 0,
    }
    w.tick = 1000
    rec.lastContactAt = 1000 - age
    return w
  }
  const stalenessAt = (age: number) => {
    const snap = buildSnapshot(snapWithAge(age), {
      running: true,
      speed: 1,
      version: 1,
      seasonComplete: false,
    })
    return snap.console.drones.find((d) => d.id === 'redding-1')!.staleness
  }

  it('reports fresh / stale / missing by contact age', () => {
    expect(stalenessAt(10)).toBe('fresh') // < 40
    expect(stalenessAt(50)).toBe('stale') // 40 < age <= 76
    expect(stalenessAt(70)).toBe('stale') // still stale — routine gaps can reach ~75
    expect(stalenessAt(80)).toBe('missing') // > 76 (deep outage / crash territory)
  })
})

describe('sweep-following dead reckoning under blackout', () => {
  const ghostOf = (scanning: boolean): [number, number] => {
    const w = createWorld(cfg0())
    const rect = scanSectorFor('redding-1')!
    const rec = w.console.drones.get('redding-1')!
    // Last fix: mid-sector, heading due east (straight-line would exit the box).
    rec.reported = {
      pos: { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 },
      heading: Math.PI / 2,
      fuelL: 500,
      retardant: 5,
      status: 'airborne',
      forcedRtb: false,
      currentDirectiveKind: null,
      queueLen: 0,
      scanning,
      scanOrientation: 'horizontal',
      extinguishedTotal: 0,
    }
    w.tick = 1000
    rec.lastContactAt = 1000 - 60 // 60 min blackout
    const snap = buildSnapshot(w, { running: true, speed: 1, version: 1, seasonComplete: false })
    return snap.console.drones.find((d) => d.id === 'redding-1')!.ghostPosition!
  }

  it('keeps the scanning ghost inside its sector, unlike a straight-line guess', () => {
    const rect = scanSectorFor('redding-1')!
    const toM = (ll: [number, number]) => lngLatToMeters(ll[0], ll[1])
    const sweep = toM(ghostOf(true))
    const straight = toM(ghostOf(false))
    const inSector = (p: { x: number; y: number }) =>
      p.x >= rect.minX - 1 && p.x <= rect.maxX + 1 && p.y >= rect.minY - 1 && p.y <= rect.maxY + 1
    // Following the lawnmower keeps it within the assigned box...
    expect(inSector(sweep)).toBe(true)
    // ...whereas dead-reckoning straight east over 60 min flies it out.
    expect(inSector(straight)).toBe(false)
    // And the two estimates genuinely differ.
    expect(Math.hypot(sweep.x - straight.x, sweep.y - straight.y)).toBeGreaterThan(1000)
  })

  it('orients the scanning ghost along the sweep, not the frozen reported heading', () => {
    const w = createWorld(cfg0())
    const rect = scanSectorFor('redding-1')!
    const rec = w.console.drones.get('redding-1')!
    const pos = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 }
    // Report an arbitrary heading that is NOT a sweep direction (sweeps are axis-aligned).
    rec.reported = {
      pos,
      heading: 0.5,
      fuelL: 500,
      retardant: 5,
      status: 'airborne',
      forcedRtb: false,
      currentDirectiveKind: null,
      queueLen: 0,
      scanning: true,
      scanOrientation: 'horizontal',
      extinguishedTotal: 0,
    }
    const age = 40
    w.tick = 1000
    rec.lastContactAt = 1000 - age
    const view = buildSnapshot(w, {
      running: true,
      speed: 1,
      version: 1,
      seasonComplete: false,
    }).console.drones.find((d) => d.id === 'redding-1')!

    // The reconstructed sweep is axis-aligned; the ghost heading should track the
    // local leg direction at the ghost's position (parallel or anti-parallel —
    // the dead-reckoner picks travel direction from the reported heading), not
    // stay frozen at the arbitrary reported 0.5.
    const cfg = w.cfg
    const path = buildLawnmower(rect, pos, sweepSpacingM(cfg), 'horizontal')
    const ghost = lngLatToMeters(view.ghostPosition![0], view.ghostPosition![1])
    const tangent = headingAtDistance(path, nearestArcLength(path, ghost))
    // Heading is parallel (mod π) to the sweep leg at the ghost point...
    expect(Math.abs(Math.sin(view.heading! - tangent))).toBeLessThan(1e-3)
    // ...and no longer frozen at the reported heading.
    expect(Math.abs(Math.sin(view.heading! - 0.5))).toBeGreaterThan(0.1)
  })

  it('dead-reckons forward when the last fix was on the second half of a sweep', () => {
    // Regression: the console reconstructs the sweep with buildLawnmower(entry =
    // rep.pos). buildLawnmower flips the whole path when the entry is nearer the
    // far endpoint, so a fix taken past the pass midpoint yields a REVERSED path.
    // A blind +dist step then runs the ghost — and its heading — backwards along
    // the scan. The dead-reckoner must instead derive travel direction from the
    // reported heading. (Only "sometimes": exactly when disconnected on the
    // returning half of a leg.)
    const w = createWorld(cfg0())
    const cfg = w.cfg
    const rect = scanSectorFor('redding-1')!
    // Take a real fix on the SECOND half of the true sweep: build the path the
    // drone actually flies (entry at the sector's start corner), then sample a
    // mid-leg point past the midpoint. Its tangent is the drone's true heading.
    const truePath = buildLawnmower(
      rect,
      { x: rect.minX, y: rect.minY },
      sweepSpacingM(cfg),
      'horizontal',
    )
    const strue = 0.54 * pathLength(truePath)
    const pos = pointAtDistance(truePath, strue)
    const trueHeading = headingAtDistance(truePath, strue)

    const rec = w.console.drones.get('redding-1')!
    rec.reported = {
      pos: { x: pos.x, y: pos.y },
      heading: trueHeading,
      fuelL: 500,
      retardant: 5,
      status: 'airborne',
      forcedRtb: false,
      currentDirectiveKind: null,
      queueLen: 0,
      scanning: true,
      scanOrientation: 'horizontal',
      extinguishedTotal: 0,
    }
    const age = 5 // short gap: the ghost stays on this leg
    w.tick = 1000
    rec.lastContactAt = 1000 - age
    const view = buildSnapshot(w, {
      running: true,
      speed: 1,
      version: 1,
      seasonComplete: false,
    }).console.drones.find((d) => d.id === 'redding-1')!

    // The ghost must advance IN the direction the drone was flying, not against
    // it: displacement from the last fix agrees with the reported heading.
    const ghost = lngLatToMeters(view.ghostPosition![0], view.ghostPosition![1])
    const disp = { x: ghost.x - pos.x, y: ghost.y - pos.y }
    const headingVec = { x: Math.sin(trueHeading), y: Math.cos(trueHeading) }
    expect(disp.x * headingVec.x + disp.y * headingVec.y).toBeGreaterThan(0)
    // And the ghost heading points forward too, not 180° reversed.
    expect(Math.cos(view.heading! - trueHeading)).toBeGreaterThan(0)
  })
})
