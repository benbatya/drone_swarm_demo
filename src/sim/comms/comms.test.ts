import { describe, expect, it } from 'vitest'
import { makeConfig } from '../config'
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
    // Routine windows never cross the 64-min missing threshold.
    for (const w of routine) expect(w.endMin - w.startMin).toBeLessThanOrEqual(cfg.routineDarkMaxMin)
    // Deep outages exceed it.
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

  it('halves the retry interval 16→8→4→2→1 while dark', () => {
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
    expect(deltas.slice(0, 6)).toEqual([16, 8, 4, 2, 1, 1])
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
    expect(stalenessAt(50)).toBe('stale') // 40 < age <= 64
    expect(stalenessAt(70)).toBe('missing') // > 64
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
})
