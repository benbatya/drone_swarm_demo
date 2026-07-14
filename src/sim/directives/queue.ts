import { makeConfig, type SimConfig } from '../config'
import type { DroneTruth } from '../drones/drone'
import { createExec } from './executor'
import type { Directive } from './types'

/** Importance descending, then issuedAt ascending (older first). */
export function sortQueue(q: Directive[]): void {
  q.sort((a, b) => b.importance - a.importance || a.issuedAt - b.issuedAt)
}

/**
 * (Re)activate the executor for the current queue head. If the head changed
 * (e.g. a higher-importance directive was inserted), the running scan's
 * progress is stashed so it resumes where it left off when it heads the queue
 * again. Non-scan execs simply restart.
 */
export function activateHead(d: DroneTruth, cfg: SimConfig = makeConfig()): void {
  const head = d.queue[0]
  if (!head) {
    d.exec = null
    d.execDirId = null
    return
  }
  if (d.execDirId === head.id && d.exec) return

  if (d.exec && d.exec.kind === 'scan' && d.execDirId) {
    d.scanProgress.set(d.execDirId, d.exec.elapsedMin)
  }
  d.exec = createExec(head, d, cfg, d.scanProgress.get(head.id) ?? 0)
  d.execDirId = head.id
}

/** Insert a directive (operator push / download), sort, and preempt if needed. */
export function enqueue(d: DroneTruth, dir: Directive, cfg: SimConfig = makeConfig()): void {
  d.queue.push(dir)
  sortQueue(d.queue)
  activateHead(d, cfg)
}

/** Head directive completed successfully — pop and advance. */
export function completeHead(d: DroneTruth, cfg: SimConfig = makeConfig()): void {
  const done = d.queue.shift()
  if (done && done.kind === 'scan') d.scanProgress.delete(done.id)
  d.exec = null
  d.execDirId = null
  activateHead(d, cfg)
}

/** Head directive aborted (fuel/retardant) — pop, record, and advance. */
export function abortHead(d: DroneTruth): Directive | null {
  const aborted = d.queue.shift() ?? null
  if (aborted) {
    if (aborted.kind === 'scan') d.scanProgress.delete(aborted.id)
    d.abortedIds.push(aborted.id)
  }
  d.exec = null
  d.execDirId = null
  return aborted
}
