// A fresh random 32-bit seed for a new sim run. This lives in the UI/runtime
// layer on purpose: `src/sim/` stays deterministic and pure (no Math.random /
// Date.now) — it only ever receives a seed via config. Each browser boot passes
// a new seed so fires ignite in different places and times, while headless tests
// (and "Run another season", which replays the boot seed) stay deterministic.
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000)
}
