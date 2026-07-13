import {
  BASE_TICKS_PER_SEC,
  MAX_TICKS_PER_FRAME,
  type SimConfig,
} from './config'
import { addPending } from './belief/consoleBelief'
import type { Directive } from './directives/types'
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
  readonly cfg: SimConfig
  private world: GroundTruth
  private rng: Rng

  private version = 0
  /** Rebuilt every frame; handed to frame listeners (the map). */
  private frameSnapshot: TruthSnapshot
  /** Only advanced at throttled emit time; stable ref for useSyncExternalStore. */
  private storeSnapshot: TruthSnapshot

  private running = false
  private speed = 1
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

  /** Advance N ticks synchronously (headless tests / manual stepping). */
  stepTicks(n: number): void {
    for (let i = 0; i < n; i++) tickWorld(this.world, this.rng)
    this.frameSnapshot = this.build()
    this.emitStore()
    this.publishHook()
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

    this.acc += dt * BASE_TICKS_PER_SEC * this.speed
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

    this.rafId = requestAnimationFrame(this.loop)
  }
}
