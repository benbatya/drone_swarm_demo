import { create } from 'zustand'
import type { CellId } from '../sim/geo'

export type Tab = 'console' | 'truth'

export type Selection =
  | { kind: 'drone'; id: string }
  | { kind: 'fire'; cellId: CellId }
  | null

export interface DraftRect {
  west: number
  south: number
  east: number
  north: number
}

interface UIState {
  activeTab: Tab
  setTab: (t: Tab) => void
  selection: Selection
  selectDrone: (id: string) => void
  selectFire: (cellId: CellId) => void
  clearSelection: () => void
  draftRect: DraftRect | null
  setDraftRect: (r: DraftRect | null) => void
  /** Shaded-relief basemap toggle — shared across both tabs. */
  showHillshade: boolean
  toggleHillshade: () => void
  /** Show every drone's scan zone (not just the selected one) — both tabs. */
  showAllScans: boolean
  toggleAllScans: () => void
}

// Local, console-side UI state. The two tabs share one view component and
// differ only by `source`: 'console' (believed state) vs 'truth' (God Mode).
export const useUIStore = create<UIState>((set) => ({
  activeTab: 'console',
  setTab: (t) => set({ activeTab: t }),
  selection: null,
  selectDrone: (id) => set({ selection: { kind: 'drone', id } }),
  selectFire: (cellId) => set({ selection: { kind: 'fire', cellId } }),
  clearSelection: () => set({ selection: null }),
  draftRect: null,
  setDraftRect: (r) => set({ draftRect: r }),
  showHillshade: false,
  toggleHillshade: () => set((s) => ({ showHillshade: !s.showHillshade })),
  showAllScans: false,
  toggleAllScans: () => set((s) => ({ showAllScans: !s.showAllScans })),
}))
