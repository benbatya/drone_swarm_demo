import { describe, expect, it } from 'vitest'
import { BASES, BBOX, WORLD_H_M, WORLD_W_M } from '../config'
import { lngLatToMeters } from '../geo'
import { parseDroneId, scanSectorFor } from './scanSectors'

const lng = (id: string) => BASES.find((b) => b.id === id)!.lng
const near = (a: number, b: number) => Math.abs(a - b) < 1 // within 1 meter

describe('scan sectors', () => {
  it('parses drone ids', () => {
    expect(parseDroneId('redding-1')).toEqual({ baseId: 'redding', index: 1 })
    expect(parseDroneId('sacramento-2')).toEqual({ baseId: 'sacramento', index: 2 })
    expect(parseDroneId('nope')).toBeNull()
  })

  it('splits longitude west/east at the base, spanning to the borders', () => {
    const w = scanSectorFor('redding-1')!
    const e = scanSectorFor('redding-2')!
    // -1 runs from the western border to the base; -2 from the base to the east.
    expect(near(w.minX, 0)).toBe(true) // west border
    expect(near(e.maxX, WORLD_W_M)).toBe(true) // east border
    const split = lngLatToMeters(lng('redding'), BBOX.south).x
    expect(near(w.maxX, split)).toBe(true)
    expect(near(e.minX, split)).toBe(true)
    // Both halves share the base's latitude band.
    expect(w.minY).toBeCloseTo(e.minY)
    expect(w.maxY).toBeCloseTo(e.maxY)
  })

  it('latitude bands run halfway to each neighbor (or the border) and tile', () => {
    const y = (lat: number) => lngLatToMeters(BBOX.west, lat).y
    const sac = scanSectorFor('sacramento-1')!
    const chico = scanSectorFor('chico-1')!
    const redding = scanSectorFor('redding-1')!
    const weed = scanSectorFor('weed-1')!

    // Southernmost base reaches the south border; northernmost the north border.
    expect(near(sac.minY, 0)).toBe(true)
    expect(near(weed.maxY, WORLD_H_M)).toBe(true)

    // Midpoints between adjacent bases (sorted S→N: sacramento, chico, redding, weed).
    expect(near(sac.maxY, y((38.58 + 39.73) / 2))).toBe(true)
    expect(near(chico.maxY, y((39.73 + 40.59) / 2))).toBe(true)
    expect(near(redding.maxY, y((40.59 + 41.42) / 2))).toBe(true)

    // Bands tile with no gaps or overlaps.
    expect(near(sac.maxY, chico.minY)).toBe(true)
    expect(near(chico.maxY, redding.minY)).toBe(true)
    expect(near(redding.maxY, weed.minY)).toBe(true)
  })

  it('returns null for unknown ids', () => {
    expect(scanSectorFor('atlantis-1')).toBeNull()
    expect(scanSectorFor('garbage')).toBeNull()
  })
})
