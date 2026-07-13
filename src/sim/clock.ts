import { TICKS_PER_DAY } from './config'

// The sim clock is just the tick counter (1 tick = 1 sim-minute). These
// helpers derive day-of-season and wall-clock time for display.

export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY)
}

/** "HH:MM" within the current sim-day. */
export function hourMinOf(tick: number): string {
  const m = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY
  const hh = String(Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  return `${hh}:${mm}`
}
