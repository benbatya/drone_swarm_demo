import { TICKS_PER_SEASON, type SimConfig } from '../config'
import type { Rng } from '../rng'

export interface DarkWindow {
  startMin: number
  endMin: number
  deep: boolean
}

export interface DroneCommsState {
  darkWindows: DarkWindow[]
  /** Monotonic cursor into darkWindows for isDarkAt. */
  cursor: number
  nextSyncAt: number
  retryIntervalMin: number
  lastSyncAt: number
}

/**
 * Alternating connected/dark windows across the horizon. Each dark window is a
 * routine outage with probability (1 − deepOutageProb) or a rare deep outage.
 * Blended dark fraction lands ~56% (within the 40–60% target).
 */
export function generateDarkWindows(
  rng: Rng,
  horizonMin: number,
  cfg: SimConfig,
): DarkWindow[] {
  const wins: DarkWindow[] = []
  let t = 0
  while (t < horizonMin) {
    t += rng.range(cfg.connMinMin, cfg.connMaxMin) // connected
    if (t >= horizonMin) break
    const deep = rng.next() < cfg.deepOutageProb
    const dur = deep
      ? rng.range(cfg.deepDarkMinMin, cfg.deepDarkMaxMin)
      : rng.range(cfg.routineDarkMinMin, cfg.routineDarkMaxMin)
    const start = t
    t += dur
    wins.push({ startMin: start, endMin: Math.min(t, horizonMin), deep })
  }
  return wins
}

/** Whether the drone is in a dark window at `now`. `now` must be monotonic. */
export function isDarkAt(state: DroneCommsState, now: number): boolean {
  const wins = state.darkWindows
  while (state.cursor < wins.length && wins[state.cursor].endMin <= now) {
    state.cursor++
  }
  const w = wins[state.cursor]
  return !!w && now >= w.startMin && now < w.endMin
}

export function makeCommsState(rng: Rng, cfg: SimConfig): DroneCommsState {
  return {
    darkWindows: generateDarkWindows(rng, TICKS_PER_SEASON + 1000, cfg),
    cursor: 0,
    // Stagger first sync across the first cadence so drones don't all sync together.
    nextSyncAt: 1 + rng.int(cfg.syncCadenceMin),
    retryIntervalMin: 0,
    lastSyncAt: -Infinity,
  }
}
