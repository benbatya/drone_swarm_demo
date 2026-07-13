// Seeded PRNG (mulberry32) + sampling helpers. Determinism across the whole
// sim depends on this: same seed -> identical sequence -> identical season.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Integer in [0, maxExcl). */
  int(maxExcl: number): number
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number
  /** Poisson sample with the given mean (Knuth). */
  poisson(lambda: number): number
  /** Deterministic child stream (e.g. per-drone blackout RNG). */
  fork(salt: number): Rng
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (maxExcl) => Math.floor(next() * maxExcl),
    range: (lo, hi) => lo + next() * (hi - lo),
    poisson: (lambda) => {
      if (lambda <= 0) return 0
      const L = Math.exp(-lambda)
      let k = 0
      let p = 1
      do {
        k++
        p *= next()
      } while (p > L)
      return k - 1
    },
    fork: (salt) => makeRng((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0),
  }
  return rng
}
