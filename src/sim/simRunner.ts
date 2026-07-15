import {
  REAL_SEC_PER_TICK,
  DEFAULT_SPEED,
  makeConfig,
  MAX_TICKS_PER_FRAME,
  TICKS_PER_SEASON,
  type SimConfig,
} from './config'
import { addPending, addPendingSector } from './belief/consoleBelief'
import type { DarkWindow } from './comms/blackout'
import type { Directive, RectM } from './directives/types'
import { makeRng, type Rng } from './rng'
import { buildSnapshot, type TruthSnapshot } from './snapshot'
import { createWorld, tickWorld, type GroundTruth } from './world'

// Test hook exposed on window for the Playwright smoke test. Exposed in all
// builds (the E2E runs against `vite preview`, a production build) — it is a
// tiny read-only status object.
interface SimHook {
  frameCount: number
  tickCount: number
  running: boolean
  drone0: [number, number]
  activeFires: number
}
declare global {
  interface Window {
    __SIM__?: SimHook
  }
}

/**
 * Owns the sim world and the single rAF loop. Everything else (React panels,
 * the deck.gl map) reads snapshots — panels via the throttled store, the map
 * via the per-frame callback.
 */
export class SimRunner {
  cfg: SimConfig
  private world: GroundTruth
  private rng: Rng

  private seasonComplete = false
  private version = 0
  /** Rebuilt every frame; handed to frame listeners (the map). */
  private frameSnapshot: TruthSnapshot
  /** Only advanced at throttled emit time; stable ref for useSyncExternalStore. */
  private storeSnapshot: TruthSnapshot

  private running = false
  private speed = DEFAULT_SPEED
  private rafId = 0
  private lastTs = 0
  private acc = 0
  private frameCount = 0
  private lastStoreNotify = 0

  private storeListeners = new Set<() => void>()
  private frameListeners = new Set<(s: TruthSnapshot) => void>()

  constructor(cfg: SimConfig) {
    this.cfg = cfg
    this.rng = makeRng(cfg.seed)
    this.world = createWorld(cfg)
    this.frameSnapshot = this.build()
    this.storeSnapshot = this.frameSnapshot
    this.publishHook()
  }

  private build(): TruthSnapshot {
    this.version++
    return buildSnapshot(this.world, {
      running: this.running,
      speed: this.speed,
      version: this.version,
      seasonComplete: this.seasonComplete,
    })
  }

  private publishHook(): void {
    if (typeof window === 'undefined') return
    const d0 = this.frameSnapshot.drones[0]
    window.__SIM__ = {
      frameCount: this.frameCount,
      tickCount: this.world.tick,
      running: this.running,
      drone0: d0 ? d0.position : [0, 0],
      activeFires: this.frameSnapshot.score.activeFires,
    }
  }

  // --- store (throttled; drives React panels) ---
  subscribeStore = (cb: () => void): (() => void) => {
    this.storeListeners.add(cb)
    return () => {
      this.storeListeners.delete(cb)
    }
  }

  getStoreSnapshot = (): TruthSnapshot => this.storeSnapshot

  private emitStore(): void {
    this.storeSnapshot = this.frameSnapshot
    for (const cb of this.storeListeners) cb()
  }

  // --- per-frame (drives the imperative deck.gl map) ---
  onFrame = (cb: (s: TruthSnapshot) => void): (() => void) => {
    this.frameListeners.add(cb)
    cb(this.frameSnapshot) // draw immediately on mount
    return () => {
      this.frameListeners.delete(cb)
    }
  }

  // --- controls ---
  isRunning(): boolean {
    return this.running
  }
  getSpeed(): number {
    return this.speed
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTs = 0
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(this.loop)
    }
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId)
    }
    this.rafId = 0
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
  }

  toggle(): void {
    if (this.running) this.pause()
    else this.start()
  }

  setSpeed(n: number): void {
    this.speed = n
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
  }

  /**
   * Set the playback speed and ensure the sim is running. The control bar's
   * speed buttons are exclusive with the paused state, so picking a speed is
   * also how the operator unpauses.
   */
  playAtSpeed(n: number): void {
    if (this.running) {
      this.setSpeed(n)
    } else {
      this.speed = n // start() rebuilds/emits with the new speed
      this.start()
    }
  }

  /**
   * Operator input: queue a pending directive for a drone (the console pushes;
   * the drone downloads it at its next successful sync). issuedAt is stamped to
   * the current tick.
   */
  issueDirective(droneId: string, directive: Directive): void {
    const now = this.world.tick
    addPending(this.world.console, droneId, { ...directive, issuedAt: now }, now)
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
  }

  /**
   * Operator input: persistently redefine a drone's standing scan sector (the
   * console pushes; the drone adopts it at its next successful sync and reports
   * it back). Pass `rect: null` to restore the drone's default sector.
   */
  setScanSector(droneId: string, rect: RectM | null): void {
    const now = this.world.tick
    addPendingSector(this.world.console, droneId, rect, now)
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
  }

  /** Advance N ticks synchronously (headless tests / manual stepping). */
  stepTicks(n: number): void {
    for (let i = 0; i < n; i++) tickWorld(this.world, this.rng)
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
  }

  isSeasonComplete(): boolean {
    return this.seasonComplete
  }

  /** Read a drone's blackout schedule for the God-Mode timeline strip. */
  getBlackout(
    id: string,
  ): { windows: DarkWindow[]; now: number; lastSyncAt: number; docked: boolean } | null {
    const d = this.world.drones.find((x) => x.id === id)
    if (!d) return null
    return {
      windows: d.comms.darkWindows,
      now: this.world.tick,
      lastSyncAt: d.comms.lastSyncAt,
      // Docked drones are hard-lined at base — never blacked out.
      docked: d.status === 'docked',
    }
  }

  /** Rebuild the world with new config overrides (left paused). */
  reconfigure(overrides: Partial<SimConfig>): void {
    this.pause()
    this.cfg = makeConfig({ ...this.cfg, ...overrides })
    this.rng = makeRng(this.cfg.seed)
    this.world = createWorld(this.cfg)
    this.seasonComplete = false
    this.acc = 0
    this.lastTs = 0
    this.frameSnapshot = this.build()
    this.storeSnapshot = this.frameSnapshot
    this.emitStore()
    this.publishHook()
  }

  /** Apply config overrides and start a fresh season. */
  applyConfig(overrides: Partial<SimConfig>): void {
    this.reconfigure(overrides)
    this.start()
  }

  /** Restart the current season from tick 0. */
  restart(): void {
    this.applyConfig({})
  }

  dispose(): void {
    this.pause()
    this.storeListeners.clear()
    this.frameListeners.clear()
  }

  private loop = (ts: number): void => {
    if (!this.running) return
    if (this.lastTs === 0) this.lastTs = ts
    const dt = Math.min((ts - this.lastTs) / 1000, 0.1) // clamp long gaps
    this.lastTs = ts

    this.acc += (dt * this.speed) / REAL_SEC_PER_TICK
    let owed = Math.floor(this.acc)
    if (owed > MAX_TICKS_PER_FRAME) owed = MAX_TICKS_PER_FRAME
    this.acc -= owed
    for (let i = 0; i < owed; i++) tickWorld(this.world, this.rng)

    this.frameCount++
    this.frameSnapshot = this.build()
    for (const cb of this.frameListeners) cb(this.frameSnapshot)

    if (ts - this.lastStoreNotify >= 250) {
      this.lastStoreNotify = ts
      this.emitStore()
    }
    this.publishHook()

    if (this.world.tick >= TICKS_PER_SEASON) {
      this.seasonComplete = true
      this.pause() // stops the loop, rebuilds with seasonComplete = true
      return
    }
    this.rafId = requestAnimationFrame(this.loop)
  }
}
