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
 * Console brightness (HSV value) derived from the staleness fraction — the same
 * 0 (fresh) → 1 (MISSING) ramp `snapshot.ts` computes against the MISSING
 * threshold, so the marker fades to black exactly as the drone trips MISSING.
 * Brightness is simply its inverse; a successful sync resets the fraction to 0,
 * restoring full brightness. Never-contacted drones arrive with frac 1 (black).
 */
export function staleValue(stalenessFrac: number): number {
  return 1 - Math.min(Math.max(stalenessFrac, 0), 1)
}

export const rgbCss = ([r, g, b]: RGB): string => `rgb(${r}, ${g}, ${b})`
