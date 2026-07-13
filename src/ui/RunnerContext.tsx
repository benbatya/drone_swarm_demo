import { createContext, useContext, type ReactNode } from 'react'
import type { SimRunner } from '../sim/simRunner'

const RunnerContext = createContext<SimRunner | null>(null)

export function RunnerProvider({
  runner,
  children,
}: {
  runner: SimRunner
  children: ReactNode
}) {
  return <RunnerContext.Provider value={runner}>{children}</RunnerContext.Provider>
}

export function useRunner(): SimRunner {
  const r = useContext(RunnerContext)
  if (!r) throw new Error('useRunner must be used within a RunnerProvider')
  return r
}
