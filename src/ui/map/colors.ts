export type RGB = [number, number, number]

export function lerp(a: RGB, b: RGB, t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
  ]
}

/** Current/fresh drones render green; they fade to blue as staleness grows. */
export const FRESH_GREEN: RGB = [80, 220, 130]
export const STALE_BLUE: RGB = [70, 130, 255]

/** Staleness color for a fraction in [0,1] (0 = fresh, 1 = missing). */
export function stalenessColor(frac: number): RGB {
  return lerp(FRESH_GREEN, STALE_BLUE, frac)
}
