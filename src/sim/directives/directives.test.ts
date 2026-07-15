import { describe, expect, it } from 'vitest'
import { makeConfig } from '../config'
import { cellIdOf } from '../geo'
import { makeRng } from '../rng'
import { createWorld, tickWorld, type GroundTruth } from '../world'
import { homeSectorRect, type DroneTruth } from '../drones/drone'
import { enqueue } from './queue'
import type { Directive, RectM, ScanExec } from './types'

const rng = () => makeRng(1)
const world = (): GroundTruth => createWorld(makeConfig({ ignitionLambdaPerMin: 0 }))

let uid = 0
const mkScan = (imp: number, dur: number, rect: RectM): Directive => ({
  kind: 'scan',
  id: `s${uid++}`,
  importance: imp,
  issuedAt: uid,
  rect,
  durationMin: dur,
})
const mkRtb = (imp: number, baseId: string): Directive => ({
  kind: 'rtb',
  id: `r${uid++}`,
  importance: imp,
  issuedAt: uid,
  baseId,
})
const mkExt = (imp: number, cellId: number): Directive => ({
  kind: 'extinguish',
  id: `e${uid++}`,
  importance: imp,
  issuedAt: uid,
  cellId,
})

const rectAround = (d: DroneTruth): RectM => homeSectorRect(d.homePos, 100)

describe('directive queue', () => {
  it('orders by importance and preempts, resuming saved scan progress', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const a = mkScan(5, 1000, rectAround(d))
    enqueue(d, a)
    for (let i = 0; i < 10; i++) tickWorld(w, r)

    expect(d.exec?.kind).toBe('scan')
    expect(d.execDirId).toBe(a.id)
    expect((d.exec as ScanExec).elapsedMin).toBeGreaterThanOrEqual(10)

    const b = mkScan(9, 1, rectAround(d)) // higher importance, 1-min scan
    enqueue(d, b)
    expect(d.execDirId).toBe(b.id)
    expect(d.scanProgress.get(a.id)).toBeGreaterThanOrEqual(10)

    tickWorld(w, r) // b completes -> a resumes
    expect(d.execDirId).toBe(a.id)
    expect((d.exec as ScanExec).elapsedMin).toBeGreaterThanOrEqual(10)
  })
})

describe('extinguish executor', () => {
  it('douses a fire and consumes one retardant load', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const p = { x: d.homePos.x + 3000, y: d.homePos.y }
    const id = cellIdOf(p)
    w.fires.set(id, { cellId: id, ignitedAt: 1 })
    const ret0 = d.retardant

    enqueue(d, mkExt(7, id))
    for (let i = 0; i < 6 && w.fires.has(id); i++) tickWorld(w, r)

    expect(w.fires.has(id)).toBe(false)
    expect(w.score.doused).toBe(1)
    expect(d.retardant).toBe(ret0 - 1)
    // The extinguished cell is logged to report to the console at the next sync,
    // and the running total (reported telemetry) incremented.
    expect(d.dousedSinceSync.map((e) => e.cellId)).toContain(id)
    expect(d.extinguishedTotal).toBe(1)
  })

  it('completes without a drop if the fire is already out', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    const id = cellIdOf({ x: d.homePos.x + 3000, y: d.homePos.y })
    // No fire at id — directive should just complete.
    enqueue(d, mkExt(7, id))
    const ret0 = d.retardant
    tickWorld(w, r)
    expect(d.queue.length).toBe(0)
    expect(d.retardant).toBe(ret0)
  })
})

describe('RTB executor', () => {
  it('docks, waits turnaround, then refuels and rearms', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    d.fuelL = 500
    d.retardant = 5
    enqueue(d, mkRtb(6, d.homeBaseId))

    let ticks = 0
    while (d.queue.length > 0 && ticks < 200) {
      tickWorld(w, r)
      ticks++
    }
    expect(d.status).toBe('airborne')
    // Refueled to (near) full — the relaunch tick burns one minute of fuel.
    expect(d.fuelL).toBeGreaterThan(w.cfg.fuelCapacityL - w.cfg.fuelBurnLPerMin - 1)
    expect(d.retardant).toBe(w.cfg.retardantLoads)
    expect(ticks).toBeGreaterThanOrEqual(w.cfg.turnaroundMin)
  })
})

describe('fuel policy', () => {
  it('aborts the running directive and forces RTB below the fuel floor', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    // Fly it far from every base so the forced RTB is a real transit (stays
    // airborne this tick) — otherwise it docks at base and the hard-lined
    // every-tick sync would report and clear abortedIds within the same tick.
    d.pos = { x: 30_000, y: 300_000 }
    d.comms.nextSyncAt = 1_000_000 // no sync this tick, so abortedIds persists
    enqueue(d, mkScan(5, 1000, rectAround(d)))
    const scanId = d.execDirId!
    d.fuelL = w.cfg.lowFuelFloorL - 1

    tickWorld(w, r)

    expect(d.status).toBe('airborne')
    expect(d.override?.kind).toBe('rtb')
    expect(d.forcedRtb).toBe(true)
    expect(d.abortedIds).toContain(scanId)
    expect(d.queue.length).toBe(0)
  })

  it('forces RTB to rearm when retardant hits zero', () => {
    const w = world()
    const r = rng()
    const d = w.drones[0]
    d.retardant = 0
    tickWorld(w, r)
    expect(d.override?.kind).toBe('rtb')
    expect(d.forcedRtb).toBe(true)
  })
})
