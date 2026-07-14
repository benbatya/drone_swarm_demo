export type RGB = [number, number, number]

/** HSV → RGB. `h` in degrees, `s` and `v` in [0,1]. Returns 0–255 ints. */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const hp = (((h % 360) + 360) % 360) / 60
  const c = v * s
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g] = [c, x]
  else if (hp < 2) [r, g] = [x, c]
  else if (hp < 3) [g, b] = [c, x]
  else if (hp < 4) [g, b] = [x, c]
  else if (hp < 5) [r, b] = [x, c]
  else [r, b] = [c, x]
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/**
 * Console brightness (HSV value) derived from contact age. Full (1.0) when
 * fresh, then dropping by 1-per-minute on a 0–100 scale (i.e. −0.01/min) for
 * every minute a drone is blacked out, floored at 0 (black). A successful sync
 * resets contact age to 0, restoring the value to maximum.
 */
export function staleValue(contactAgeMin: number | null): number {
  if (contactAgeMin == null) return 0
  return Math.max(0, 1 - contactAgeMin / 100)
}

export const rgbCss = ([r, g, b]: RGB): string => `rgb(${r}, ${g}, ${b})`
