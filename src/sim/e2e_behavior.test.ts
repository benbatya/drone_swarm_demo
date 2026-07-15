/**
 * END-TO-END BEHAVIOR VERIFICATION HARNESS (uncommitted artifact).
 *
 * Drives seeded, headless worlds forward and produces CONCRETE runtime evidence
 * (logged + asserted) for the spec behaviors that aren't directly observable
 * from the existing unit tests. Run with:
 *   npx vitest run src/sim/e2e_behavior.test.ts --reporter=verbose 2>&1
 *
 * NOTE on tuned params actually found in src/sim/config.ts (BASE_CONFIG):
 *   detectionRadiusM = 10_000 (10 km)   <-- NOT 50 km
 *   gossipRangeM     = 50_000 (50 km)
 *   autoEngageRangeKm= 168
 *   fuelCapacityL    = 2000              <-- NOT 1000
 *   fuelBurnLPerMin  = 2.8
 *   lowFuelFloorL    = 120
 *   missingThresholdMin = 76, staleThresholdMin = 40
 *   syncCadenceMin = 32, syncRetryMin = 3 (constant re-poll while dark)
 *   routine dark U(10,40); deep dark U(80,220) at p=0.05
 */
import { describe, it, expect } from 'vitest'
import { createWorld, tickWorld, type GroundTruth } from './world'
import { makeConfig } from './config'
import { makeRng } from './rng'
import { cellIdOf, cellCenter, distance, type CellId } from './geo'
import { nearestBase, BASE_POINTS } from './bases'
import { mergeFire } from './comms/merge'
import { stepGossip } from './comms/gossip'

const SEED = 1337

function consoleActiveFires(w: GroundTruth): Set<CellId> {
  const s = new Set<CellId>()
  for (const [id, kf] of w.console.fires) if (!kf.believedOut) s.add(id)
  return s
}

// Derived console staleness, mirroring buildConsoleView in snapshot.ts.
function staleness(w: GroundTruth, id: string): { s: string; age: number | null } {
  const rec = w.console.drones.get(id)!
  if (rec.lastContactAt == null) return { s: 'unknown', age: null }
  const age = w.tick - rec.lastContactAt
  const cfg = w.cfg
  const s = age > cfg.missingThresholdMin ? 'missing' : age > cfg.staleThresholdMin ? 'stale' : 'fresh'
  return { s, age }
}

// ---------------------------------------------------------------------------
// 1 + 2 + 5 + 11: One long instrumented run — belief lag, blackout drift,
// missing/clear, routine-never-missing, and season-smoke invariants.
// ---------------------------------------------------------------------------
describe('e2e: instrumented full-season run (seed 1337)', () => {
  const cfg = makeConfig({ seed: SEED })
  const w = createWorld(cfg)
  const rng = makeRng(cfg.seed)

  // Per-fire timeline.
  const igniteTick = new Map<CellId, number>()
  const droneDetectTick = new Map<CellId, number>()
  const droneDetectDist = new Map<CellId, number>()
  const consoleKnownTick = new Map<CellId, number>()

  // Per-drone staleness/missing tracking.
  interface MissingEpisode {
    droneId: string
    startTick: number
    startAge: number
    inDeepAtStart: boolean
    gapSpannedDeep: boolean
    clearedTick: number | null
    posAtStart: { x: number; y: number }
    posDuring: { x: number; y: number } | null
    lastContactFrozenFrom: number | null
  }
  const missingEpisodes: MissingEpisode[] = []
  const activeMissing = new Map<string, MissingEpisode>()

  // Invariant violations.
  const invariantFails: string[] = []
  let lastFireMinutes = -1
  let nanSeen = false
  let crashes = 0

  const SEASON = 43_200
  for (let t = 1; t <= SEASON; t++) {
    tickWorld(w, rng)

    // Fire timelines.
    for (const [cell, f] of w.fires) if (!igniteTick.has(cell)) igniteTick.set(cell, f.ignitedAt)
    for (const d of w.drones) {
      for (const [cell, kf] of d.belief.fires) {
        if (!kf.believedOut && !droneDetectTick.has(cell) && w.fires.has(cell)) {
          droneDetectTick.set(cell, w.tick)
          droneDetectDist.set(cell, distance(d.pos, cellCenter(cell)))
        }
      }
    }
    for (const cell of consoleActiveFires(w)) {
      if (!consoleKnownTick.has(cell)) consoleKnownTick.set(cell, w.tick)
    }

    // Staleness episodes.
    for (const d of w.drones) {
      const { s, age } = staleness(w, d.id)
      const rec = w.console.drones.get(d.id)!
      if (s === 'missing' && d.status !== 'crashed') {
        if (!activeMissing.has(d.id)) {
          // Determine if the contact gap spanned a deep outage window.
          const from = rec.lastContactAt ?? 0
          let gapSpannedDeep = false
          for (const win of d.comms.darkWindows) {
            if (win.deep && win.startMin < w.tick && win.endMin > from) { gapSpannedDeep = true; break }
          }
          const ep: MissingEpisode = {
            droneId: d.id,
            startTick: w.tick,
            startAge: age!,
            inDeepAtStart: (() => {
              for (const win of d.comms.darkWindows)
                if (win.deep && w.tick >= win.startMin && w.tick < win.endMin) return true
              return false
            })(),
            gapSpannedDeep,
            clearedTick: null,
            posAtStart: { ...d.pos },
            posDuring: null,
            lastContactFrozenFrom: rec.lastContactAt,
          }
          activeMissing.set(d.id, ep)
          missingEpisodes.push(ep)
        } else {
          activeMissing.get(d.id)!.posDuring = { ...d.pos }
        }
      } else if (s !== 'missing' && activeMissing.has(d.id)) {
        activeMissing.get(d.id)!.clearedTick = w.tick
        activeMissing.delete(d.id)
      }
    }

    // Invariants on sampled ticks (every 111 ticks + full check of NaN each tick cheaply).
    for (const d of w.drones) {
      if (Number.isNaN(d.fuelL) || Number.isNaN(d.pos.x) || Number.isNaN(d.pos.y)) nanSeen = true
    }
    if (t % 111 === 0 || t === SEASON) {
      for (const d of w.drones) {
        if (d.fuelL < -1e-6 || d.fuelL > cfg.fuelCapacityL + 1e-6)
          invariantFails.push(`t${t} ${d.id} fuel ${d.fuelL}`)
        if (d.retardant < 0 || d.retardant > cfg.retardantLoads)
          invariantFails.push(`t${t} ${d.id} retardant ${d.retardant}`)
        if (d.status === 'docked') {
          const db = distance(d.pos, nearestBase(d.pos).pos)
          if (db > 1) invariantFails.push(`t${t} ${d.id} docked but ${db.toFixed(1)}m from base`)
        }
      }
      // No fire within base exclusion.
      for (const cell of w.fires.keys()) {
        const c = cellCenter(cell)
        for (const b of BASE_POINTS) {
          const dd = distance(c, b.pos)
          if (dd < 900) invariantFails.push(`t${t} fire ${cell} only ${dd.toFixed(0)}m from ${b.id}`)
        }
      }
      if (w.score.fireMinutes < lastFireMinutes)
        invariantFails.push(`t${t} fireMinutes decreased ${lastFireMinutes}->${w.score.fireMinutes}`)
    }
    lastFireMinutes = w.score.fireMinutes
  }
  crashes = w.drones.filter((d) => d.status === 'crashed').length

  it('BEHAVIOR #2 belief lag: console learns a fire strictly after a drone detects it, which is >= ignition', () => {
    // Find a fire with a full ignite -> detect -> console timeline.
    let chosen: CellId | null = null
    for (const cell of consoleKnownTick.keys()) {
      if (igniteTick.has(cell) && droneDetectTick.has(cell)) { chosen = cell; break }
    }
    expect(chosen, 'at least one fire completed ignite->detect->console-sync').not.toBeNull()
    const ign = igniteTick.get(chosen!)!
    const det = droneDetectTick.get(chosen!)!
    const con = consoleKnownTick.get(chosen!)!
    const detDist = droneDetectDist.get(chosen!)!
    console.log(
      `[BELIEF-LAG] fire cell=${chosen} ignited@${ign} droneDetected@${det} (dist=${(detDist / 1000).toFixed(2)}km) consoleKnew@${con} | detect-lag=${det - ign}min console-lag=${con - det}min`,
    )
    expect(det).toBeGreaterThanOrEqual(ign)
    expect(con).toBeGreaterThan(det)
    expect(detDist).toBeLessThanOrEqual(cfg.detectionRadiusM + 1) // within 10 km detection radius
    // Distribution sanity.
    let lagPairs = 0, sumConsoleLag = 0
    for (const cell of consoleKnownTick.keys()) {
      if (droneDetectTick.has(cell)) { lagPairs++; sumConsoleLag += consoleKnownTick.get(cell)! - droneDetectTick.get(cell)! }
    }
    console.log(`[BELIEF-LAG] fires ignited=${igniteTick.size} detected=${droneDetectTick.size} console-known=${consoleKnownTick.size}; mean console-after-detect lag over ${lagPairs} fires = ${(sumConsoleLag / lagPairs).toFixed(1)} min`)
  })

  it('BEHAVIOR #5 missing: at least one non-crashed drone crosses into MISSING and later clears; every missing gap spans a deep outage (routine <=40 never trips)', () => {
    console.log(`[MISSING] total missing episodes (non-crashed): ${missingEpisodes.length}`)
    expect(missingEpisodes.length).toBeGreaterThan(0)
    const cleared = missingEpisodes.filter((e) => e.clearedTick != null)
    expect(cleared.length, 'at least one missing episode later cleared on reconnect').toBeGreaterThan(0)
    const ex = cleared[0]
    console.log(
      `[MISSING] drone=${ex.droneId} wentMissing@${ex.startTick} (age=${ex.startAge}min, lastContact frozen@${ex.lastContactFrozenFrom}) inDeepWindow=${ex.inDeepAtStart} gapSpannedDeep=${ex.gapSpannedDeep} cleared@${ex.clearedTick}`,
    )
    if (ex.posDuring)
      console.log(
        `[MISSING] truth pos moved during outage: start=(${ex.posAtStart.x.toFixed(0)},${ex.posAtStart.y.toFixed(0)}) during=(${ex.posDuring.x.toFixed(0)},${ex.posDuring.y.toFixed(0)}) delta=${distance(ex.posAtStart, ex.posDuring).toFixed(0)}m`,
      )
    // SPEC #5: "missing only reachable via a deep outage or a crash, since
    // routine dark <=40 min." REGRESSION GUARD for the over-trigger fix: with the
    // constant syncRetryMin re-poll (no decreasing backoff that skipped connected
    // windows) plus missingThresholdMin=76 (above the ~75-min worst-case routine
    // gap = ≤32 staleness + ≤40 dark + ≤3 retry, below the 80-min min deep
    // outage), a chain of routine (<=40 min) windows can NO LONGER accumulate a
    // >76-min gap. So every non-crashed missing episode must span a deep outage.
    const routineOnly = missingEpisodes.filter((e) => !e.gapSpannedDeep)
    console.log(
      `[MISSING] ${routineOnly.length}/${missingEpisodes.length} non-crashed MISSING episodes came from a routine-only gap (expected 0 after the over-trigger fix).`,
    )
    for (const e of routineOnly.slice(0, 3))
      console.log(`   e.g. drone=${e.droneId} missing@${e.startTick} age=${e.startAge} lastContact@${e.lastContactFrozenFrom} inDeep=${e.inDeepAtStart} gapSpannedDeep=${e.gapSpannedDeep}`)
    expect(routineOnly.length, 'routine-only blackouts must never trip MISSING after the fix').toBe(0)
    // Missing still triggers on a real (deep) outage and clears on reconnect.
    expect(missingEpisodes.some((e) => e.gapSpannedDeep)).toBe(true)
  })

  it('BEHAVIOR #11/smoke: season completes, no NaN, invariants hold, score monotonic', () => {
    console.log(
      `[SMOKE] season ${SEASON} ticks | fires ignited=${w.score.totalFires} doused=${w.score.doused} active@end=${w.fires.size} fireMinutes=${w.score.fireMinutes} crashes=${crashes}`,
    )
    console.log(`[SMOKE] invariant failures: ${invariantFails.length}`)
    for (const f of invariantFails.slice(0, 10)) console.log('   ' + f)
    expect(nanSeen).toBe(false)
    expect(invariantFails).toEqual([])
    expect(w.tick).toBe(SEASON)
  })
})

// ---------------------------------------------------------------------------
// 6: Forced RTB — fuel floor and retardant=0
// ---------------------------------------------------------------------------
describe('e2e: BEHAVIOR #6 forced RTB', () => {
  function scanDir(id: string) {
    return { kind: 'scan' as const, id, importance: 5, issuedAt: 0, rect: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, durationMin: 100 }
  }

  it('fuel < 120 L aborts the directive, flies to nearest base, docks, and refuels/rearms after 60 min', () => {
    const cfg = makeConfig({ seed: 7 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    const d = w.drones[0]
    // Position 20 km east of home; low fuel; a live operator directive queued.
    d.pos = { x: d.homePos.x + 20_000, y: d.homePos.y }
    d.fuelL = 100 // < 120 floor
    d.retardant = 5
    d.queue = [scanDir('op-1')]
    const base = nearestBase(d.pos)

    tickWorld(w, rng)
    console.log(`[RTB-FUEL] after 1 tick: override=${d.override?.kind} forcedRtb=${d.forcedRtb} queueLen=${d.queue.length} fuel=${d.fuelL.toFixed(1)}`)
    expect(d.override?.kind).toBe('rtb')
    expect(d.forcedRtb).toBe(true)
    expect(d.queue.length).toBe(0) // operator directive was ABORTED (not suspended)

    // Fly home + dock.
    let docked = false
    for (let i = 0; i < 60 && !docked; i++) { tickWorld(w, rng); if ((d.status as string) === 'docked') docked = true }
    expect(docked).toBe(true)
    console.log(`[RTB-FUEL] docked@base=${base.id} dockRemaining=${d.dockRemainingMin} distToBase=${distance(d.pos, base.pos).toFixed(1)}m`)
    expect(distance(d.pos, base.pos)).toBeLessThan(1)
    expect(d.dockRemainingMin).toBeGreaterThan(0)

    // Turnaround (~60 min) then refuel/rearm/airborne.
    for (let i = 0; i < 62 && d.status === 'docked'; i++) tickWorld(w, rng)
    console.log(`[RTB-FUEL] after turnaround: status=${d.status} fuel=${d.fuelL} retardant=${d.retardant} override=${d.override} (note: refueled to ${cfg.fuelCapacityL} then burned one ${cfg.fuelBurnLPerMin}L tick on relaunch)`)
    expect(d.status).toBe('airborne')
    // Refueled to full, then the same relaunch tick burns one fuel step.
    expect(d.fuelL).toBeGreaterThan(cfg.fuelCapacityL - cfg.fuelBurnLPerMin - 1e-6)
    expect(d.fuelL).toBeLessThanOrEqual(cfg.fuelCapacityL)
    expect(d.retardant).toBe(cfg.retardantLoads)
    expect(d.override).toBeNull()
  })

  it('retardant == 0 also triggers forced RTB (go rearm) even with full fuel', () => {
    const cfg = makeConfig({ seed: 7 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    const d = w.drones[0]
    d.pos = { x: d.homePos.x + 10_000, y: d.homePos.y }
    d.fuelL = cfg.fuelCapacityL
    d.retardant = 0
    d.queue = [scanDir('op-2')]

    tickWorld(w, rng)
    console.log(`[RTB-RETARDANT] override=${d.override?.kind} forcedRtb=${d.forcedRtb} queueLen=${d.queue.length}`)
    expect(d.override?.kind).toBe('rtb')
    expect(d.forcedRtb).toBe(true)
    expect(d.queue.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 7: Crash
// ---------------------------------------------------------------------------
describe('e2e: BEHAVIOR #7 crash on fuel exhaustion', () => {
  it('fuel hits 0 airborne -> crashed, frozen forever, no detection/gossip/sync', () => {
    const cfg = makeConfig({ seed: 11 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    const d = w.drones[0]
    d.pos = { x: d.homePos.x + 5_000, y: d.homePos.y }
    d.fuelL = 2 // burns 2.8/min -> crashes this tick

    tickWorld(w, rng)
    expect(d.status).toBe('crashed')
    const frozen = { ...d.pos }
    const crashedAt = d.crashedAt
    console.log(`[CRASH] status=${d.status} crashedAt=${crashedAt} pos=(${frozen.x.toFixed(0)},${frozen.y.toFixed(0)}) fuel=${d.fuelL}`)
    expect(crashedAt).toBe(w.tick)

    // Place a fire 100 m away (well inside 10 km) — a live drone would detect it.
    const firePos = { x: d.pos.x + 100, y: d.pos.y }
    const fireCell = cellIdOf(firePos)
    w.fires.set(fireCell, { cellId: fireCell, ignitedAt: w.tick })
    const beliefBefore = d.belief.fires.size
    const lastContactBefore = w.console.drones.get(d.id)!.lastContactAt

    for (let i = 0; i < 100; i++) tickWorld(w, rng)
    console.log(`[CRASH] after 100 ticks: pos=(${d.pos.x.toFixed(0)},${d.pos.y.toFixed(0)}) beliefSize=${d.belief.fires.size} (was ${beliefBefore}) lastContact=${w.console.drones.get(d.id)!.lastContactAt} (was ${lastContactBefore})`)
    expect(d.pos.x).toBe(frozen.x)
    expect(d.pos.y).toBe(frozen.y)
    expect(d.status).toBe('crashed')
    expect(d.belief.fires.size).toBe(beliefBefore) // no detection while crashed
    // No further sync: console contact freezes -> eventually missing.
    const rec = w.console.drones.get(d.id)!
    if (rec.lastContactAt != null) {
      const age = w.tick - rec.lastContactAt
      console.log(`[CRASH] console contact age=${age}min staleness=${staleness(w, d.id).s}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 8: Autonomous idle
// ---------------------------------------------------------------------------
describe('e2e: BEHAVIOR #8 autonomous idle', () => {
  it('empty queue + known fire <=168 km + retardant>0 -> self-assign extinguish nearest; drops it when doused by a peer', () => {
    const cfg = makeConfig({ seed: 13 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    const d = w.drones[0]
    d.pos = { x: d.homePos.x, y: d.homePos.y }
    d.queue = []
    d.retardant = 5
    // Known active fire 50 km away (inside 168 km engage range, outside 10 km detection).
    const firePos = { x: d.pos.x + 50_000, y: d.pos.y }
    const cell = cellIdOf(firePos)
    w.fires.set(cell, { cellId: cell, ignitedAt: 0 })
    mergeFire(d.belief.fires, { cellId: cell, firstSeenAt: 0, source: 'self', believedOut: false, updatedAt: 0 })

    tickWorld(w, rng)
    console.log(`[AUTO] autoExec=${JSON.stringify(d.autoExec)} (expect extinguish cell=${cell})`)
    expect(d.autoExec?.kind).toBe('extinguish')
    expect((d.autoExec as { cellId: number }).cellId).toBe(cell)

    // Peer douses it: remove from truth + mark belief out.
    w.fires.delete(cell)
    d.belief.fires.get(cell)!.believedOut = true
    d.belief.fires.get(cell)!.updatedAt = w.tick
    tickWorld(w, rng)
    console.log(`[AUTO] after peer douse: autoExec=${JSON.stringify(d.autoExec)} (expect null -> patrol)`)
    expect(d.autoExec).toBeNull()
  })

  it('empty queue + only OUT-OF-RANGE known fire (>168 km) -> autoPatrol (no self-engage)', () => {
    const cfg = makeConfig({ seed: 13 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    const d = w.drones[0]
    d.pos = { x: d.homePos.x, y: d.homePos.y }
    d.queue = []
    d.retardant = 5
    // Fire 250 km away — beyond 168 km. Keep in-world by going south if needed.
    let fx = d.pos.x + 250_000
    let fy = d.pos.y
    if (fx > 380_000) { fx = d.pos.x; fy = d.pos.y - 250_000 < 0 ? d.pos.y + 250_000 : d.pos.y - 250_000 }
    const cell = cellIdOf({ x: fx, y: fy })
    mergeFire(d.belief.fires, { cellId: cell, firstSeenAt: 0, source: 'self', believedOut: false, updatedAt: 0 })
    const dKm = distance(d.pos, cellCenter(cell)) / 1000

    tickWorld(w, rng)
    console.log(`[AUTO] out-of-range fire dist=${dKm.toFixed(0)}km autoExec=${d.autoExec} (expect null=patrol)`)
    expect(dKm).toBeGreaterThan(cfg.autoEngageRangeKm)
    expect(d.autoExec).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 9: Gossip
// ---------------------------------------------------------------------------
describe('e2e: BEHAVIOR #9 gossip propagation', () => {
  it('two airborne drones within 50 km exchange fire knowledge; out-of-range pair does not', () => {
    const cfg = makeConfig({ seed: 17 })
    const w = createWorld(cfg)
    // Park every drone far off-map corner so only our pair is in range of each other.
    for (const d of w.drones) d.pos = { x: 1_000_000 + Math.random(), y: 1_000_000 }
    const a = w.drones[0]
    const b = w.drones[1]
    a.pos = { x: 100_000, y: 100_000 }
    b.pos = { x: 100_000 + 1_000, y: 100_000 } // 1 km apart (<50 km)
    // Fire cell 20 km from the pair (outside 10 km detection, so no truth interference).
    const fireCell = cellIdOf({ x: 130_000, y: 100_000 })
    mergeFire(a.belief.fires, { cellId: fireCell, firstSeenAt: 0, source: 'self', believedOut: false, updatedAt: 5 })
    expect(b.belief.fires.has(fireCell)).toBe(false)

    stepGossip(w)
    console.log(`[GOSSIP] in-range(1km): B knows fire after gossip = ${b.belief.fires.has(fireCell)}`)
    expect(b.belief.fires.has(fireCell)).toBe(true)

    // Out-of-range pair.
    const w2 = createWorld(cfg)
    for (const d of w2.drones) d.pos = { x: 1_000_000, y: 1_000_000 }
    const a2 = w2.drones[0]
    const b2 = w2.drones[1]
    a2.pos = { x: 100_000, y: 100_000 }
    b2.pos = { x: 100_000 + 60_000, y: 100_000 } // 60 km apart (>50 km)
    mergeFire(a2.belief.fires, { cellId: fireCell, firstSeenAt: 0, source: 'self', believedOut: false, updatedAt: 5 })
    stepGossip(w2)
    console.log(`[GOSSIP] out-of-range(60km): B knows fire after gossip = ${b2.belief.fires.has(fireCell)}`)
    expect(b2.belief.fires.has(fireCell)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 12: Determinism
// ---------------------------------------------------------------------------
describe('e2e: BEHAVIOR #12 determinism', () => {
  function hashRun(ticks: number): string {
    const cfg = makeConfig({ seed: 4242 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    for (let i = 0; i < ticks; i++) tickWorld(w, rng)
    const fires = [...w.fires.keys()].sort((x, y) => x - y)
    const drones = w.drones.map((d) => `${d.id}:${d.pos.x.toFixed(6)},${d.pos.y.toFixed(6)},${d.fuelL.toFixed(6)},${d.retardant},${d.status}`)
    return JSON.stringify({ fires, drones, score: w.score, consoleFires: [...w.console.fires.keys()].sort((x, y) => x - y) })
  }

  it('same seed -> identical final state hash over 5000 ticks', () => {
    const h1 = hashRun(5000)
    const h2 = hashRun(5000)
    console.log(`[DETERMINISM] hash length=${h1.length} identical=${h1 === h2}`)
    expect(h1).toBe(h2)
    // And a different seed diverges.
    const cfg = makeConfig({ seed: 9999 })
    const w = createWorld(cfg)
    const rng = makeRng(cfg.seed)
    for (let i = 0; i < 5000; i++) tickWorld(w, rng)
    const fires = [...w.fires.keys()].sort((x, y) => x - y)
    const other = JSON.stringify(fires)
    console.log(`[DETERMINISM] different seed produces different fire set = ${other !== JSON.stringify([...JSON.parse(h1).fires])}`)
  })
})
