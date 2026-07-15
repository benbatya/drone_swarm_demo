import { describe, expect, it } from 'vitest'
import { scanSectorFor } from '../../sim/drones/scanSectors'
import type { RectM } from '../../sim/directives/types'
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

  it('flips the hatch path when the drone sweep orientation changes', () => {
    const hatchPath = (orientation: 'horizontal' | 'vertical') => {
      const layers = scanZoneLayers([{ id: 'redding-1', hue: 0, scanOrientation: orientation }], {
        selectedId: 'redding-1',
        showAll: false,
      })
      const hatches = layers.find((l) => l.id === 'scan-hatches')
      // @ts-expect-error deck.gl layer props at runtime
      return hatches.props.data[0].path as [number, number][]
    }
    expect(hatchPath('horizontal')).not.toEqual(hatchPath('vertical'))
  })

  it('honors an operator-redefined scanRect over the fixed default sector', () => {
    const def = scanSectorFor('redding-1')!
    // A distinct rectangle far from the default sector.
    const custom: RectM = {
      minX: def.minX + 50_000,
      minY: def.minY + 50_000,
      maxX: def.minX + 90_000,
      maxY: def.minY + 90_000,
    }
    const ringOf = (d: ScanDrone) => {
      const layers = scanZoneLayers([d], { selectedId: 'redding-1', showAll: false })
      const zones = layers.find((l) => l.id === 'scan-zones')!
      // @ts-expect-error deck.gl layer props at runtime
      return zones.props.data[0].ring as [number, number][]
    }
    const defaultRing = ringOf({ id: 'redding-1', hue: 0 })
    const customRing = ringOf({ id: 'redding-1', hue: 0, scanRect: custom })
    expect(customRing).not.toEqual(defaultRing)
    // A null scanRect falls back to the fixed default sector.
    expect(ringOf({ id: 'redding-1', hue: 0, scanRect: null })).toEqual(defaultRing)
  })
})
