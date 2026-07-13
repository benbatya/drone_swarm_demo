// Fire-minutes accumulator. Score is the total minutes fires spent burning
// across the season — the God-Mode-only measure of how well the fleet did.

export interface Score {
  fireMinutes: number
  totalFires: number
  doused: number
}

export function makeScore(): Score {
  return { fireMinutes: 0, totalFires: 0, doused: 0 }
}

/** Add the current active-fire count to fire-minutes (called once per tick). */
export function accrue(score: Score, activeFireCount: number): void {
  score.fireMinutes += activeFireCount
}
