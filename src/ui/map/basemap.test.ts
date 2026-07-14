import { describe, expect, it } from 'vitest'
import { BBOX } from '../../sim/config'
import { basemapLayers } from './basemap'
import landData from '../../sim/land.json'
import placesData from './geo/places.json'

const M = 0.35 // clip margin used by scripts/build-basemap.mjs (plus slack)

function allCoords(geom: unknown, out: [number, number][] = []): [number, number][] {
  if (Array.isArray(geom)) {
    if (typeof geom[0] === 'number') out.push(geom as [number, number])
    else for (const g of geom) allCoords(g, out)
  }
  return out
}

describe('basemap data', () => {
  it('ships committed Natural Earth features', () => {
    expect(landData.features.length).toBeGreaterThan(0)
    expect(placesData.features.length).toBeGreaterThan(0)
  })

  it('is clipped to the NorCal bbox', () => {
    for (const f of landData.features) {
      for (const [lng, lat] of allCoords((f.geometry as { coordinates: unknown }).coordinates)) {
        expect(lng).toBeGreaterThanOrEqual(BBOX.west - M)
        expect(lng).toBeLessThanOrEqual(BBOX.east + M)
        expect(lat).toBeGreaterThanOrEqual(BBOX.south - M)
        expect(lat).toBeLessThanOrEqual(BBOX.north + M)
      }
    }
  })

  it('labels real population centers within the bbox', () => {
    const names = placesData.features.map((f) => (f.properties as { name: string }).name)
    expect(names).toContain('Sacramento')
    expect(names).toContain('Eureka')
    for (const f of placesData.features) {
      const [lng, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
      expect(lng).toBeGreaterThanOrEqual(BBOX.west - M)
      expect(lng).toBeLessThanOrEqual(BBOX.east + M)
      expect(lat).toBeGreaterThanOrEqual(BBOX.south - M)
      expect(lat).toBeLessThanOrEqual(BBOX.north + M)
    }
  })
})

describe('basemapLayers', () => {
  it('omits the hillshade layer when off, includes it when on', () => {
    const off = basemapLayers({ hillshade: false })
    const on = basemapLayers({ hillshade: true })
    expect(off.some((l) => l.id === 'hillshade')).toBe(false)
    expect(on.some((l) => l.id === 'hillshade')).toBe(true)
    // Core vector layers are always present.
    for (const id of ['land', 'lakes', 'rivers', 'states', 'places-labels']) {
      expect(off.some((l) => l.id === id)).toBe(true)
    }
    expect(on.length).toBe(off.length + 1)
  })
})
