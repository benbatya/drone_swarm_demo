import { describe, expect, it } from 'vitest'
import { scanZoneLayers, type ScanDrone } from './scanZones'

const FLEET: ScanDrone[] = [
  { id: 'redding-1', hue: 0 },
  { id: 'redding-2', hue: 45 },
  { id: 'chico-1', hue: 90 },
]

describe('scanZoneLayers', () => {
  it('draws nothing with no selection and showAll off', () => {
    expect(scanZoneLayers(FLEET, { selectedId: null, showAll: false })).toEqual([])
  })

  it('draws only the selected drone when showAll is off', () => {
    const layers = scanZoneLayers(FLEET, { selectedId: 'redding-1', showAll: false })
    const zones = layers.find((l) => l.id === 'scan-zones')
    expect(zones).toBeTruthy()
    // @ts-expect-error deck.gl layer props at runtime
    expect(zones.props.data).toHaveLength(1)
  })

  it('draws every drone when showAll is on, regardless of selection', () => {
    const layers = scanZoneLayers(FLEET, { selectedId: null, showAll: true })
    const zones = layers.find((l) => l.id === 'scan-zones')
    // @ts-expect-error deck.gl layer props at runtime
    expect(zones.props.data).toHaveLength(FLEET.length)
    expect(layers.some((l) => l.id === 'scan-hatches')).toBe(true)
  })
})
