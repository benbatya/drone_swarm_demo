import type { CellId } from '../geo'

export type Importance = number // 1..10, default 5

/** Axis-aligned rectangle in local plane meters. */
export interface RectM {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ScanDirective {
  kind: 'scan'
  id: string
  importance: Importance
  issuedAt: number
  rect: RectM
  durationMin: number
}

export interface ExtinguishDirective {
  kind: 'extinguish'
  id: string
  importance: Importance
  issuedAt: number
  cellId: CellId
}

export interface RtbDirective {
  kind: 'rtb'
  id: string
  importance: Importance
  issuedAt: number
  baseId: string
}

export type Directive = ScanDirective | ExtinguishDirective | RtbDirective

// --- Executor state machines (one active per drone) ------------------------

export interface ScanExec {
  kind: 'scan'
  rect: RectM
  durationMin: number // Infinity for autoPatrol
  elapsedMin: number
  waypoints: import('../geo').Vec2[]
  idx: number
}

export interface ExtinguishExec {
  kind: 'extinguish'
  cellId: CellId
}

export interface RtbExec {
  kind: 'rtb'
  baseId: string
  docking: boolean
}

export type DirectiveExec = ScanExec | ExtinguishExec | RtbExec

export type ExecStatus = 'running' | 'done'
