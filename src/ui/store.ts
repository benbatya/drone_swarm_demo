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
  /** About dialog visibility for this session (opens on load iff aboutByDefault). */
  showAbout: boolean
  setShowAbout: (v: boolean) => void
  /** Persisted preference: show the About dialog on page load (localStorage). */
  aboutByDefault: boolean
  setAboutByDefault: (v: boolean) => void
}

const ABOUT_PREF_KEY = 'fireSeason.showAboutByDefault'

/** Read the persisted "show About on load" preference (default true). */
function readAboutByDefault(): boolean {
  try {
    return localStorage.getItem(ABOUT_PREF_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeAboutByDefault(v: boolean): void {
  try {
    localStorage.setItem(ABOUT_PREF_KEY, String(v))
  } catch {
    // Ignore storage failures (private mode / disabled) — preference just won't persist.
  }
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
  showHillshade: true,
  toggleHillshade: () => set((s) => ({ showHillshade: !s.showHillshade })),
  showAllScans: true,
  toggleAllScans: () => set((s) => ({ showAllScans: !s.showAllScans })),
  // Open the About dialog on load only if the persisted preference says so.
  showAbout: readAboutByDefault(),
  setShowAbout: (v) => set({ showAbout: v }),
  aboutByDefault: readAboutByDefault(),
  setAboutByDefault: (v) => {
    writeAboutByDefault(v)
    set({ aboutByDefault: v })
  },
}))
