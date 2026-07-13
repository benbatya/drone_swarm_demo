import { create } from 'zustand'

export type Tab = 'console' | 'truth'

interface UIState {
  activeTab: Tab
  setTab: (t: Tab) => void
}

// Local, console-side UI state. The two tabs share one view component and
// differ only by `source`: 'console' (believed state) vs 'truth' (God Mode).
export const useUIStore = create<UIState>((set) => ({
  activeTab: 'truth',
  setTab: (t) => set({ activeTab: t }),
}))
