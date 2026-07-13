import { useSyncExternalStore } from 'react'
import type { TruthSnapshot } from '../sim/snapshot'
import { useRunner } from './RunnerContext'

// Subscribe React panels to the throttled store snapshot (~4Hz). The map does
// NOT use this — it consumes the per-frame callback (runner.onFrame) directly.
export function useSimSnapshot(): TruthSnapshot {
  const runner = useRunner()
  return useSyncExternalStore(
    runner.subscribeStore,
    runner.getStoreSnapshot,
    runner.getStoreSnapshot,
  )
}
