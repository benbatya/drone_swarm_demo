import type { Layer } from '@deck.gl/core'
import { PolygonLayer } from '@deck.gl/layers'

// A simplified NorCal land mass for offline geographic context. The Pacific
// coast is traced north→south down the west side (Cape Mendocino's bulge, the
// Point Reyes / SF notch); the ring then closes along the south, east, and
// north edges of the world bbox so everything inland fills as land. The map
// background is ocean, so this makes the coastline — and where the bases sit —
// legible without any tiles.
const COASTLINE: [number, number][] = [
  [-124.3, 42.1], // Oregon-border coast (NW)
  [-124.15, 41.7],
  [-124.1, 41.2],
  [-124.41, 40.44], // Cape Mendocino (westernmost)
  [-124.05, 40.0],
  [-123.82, 39.4], // Fort Bragg
  [-123.72, 38.95], // Point Arena
  [-123.05, 38.32], // Bodega Bay
  [-122.98, 38.0], // Point Reyes
  [-122.5, 37.8], // Golden Gate (SW-ish)
]

const CALIFORNIA_LAND: [number, number][] = [
  ...COASTLINE,
  [-119.9, 37.8], // SE corner
  [-119.9, 42.1], // NE corner
]

export function terrainLayers(): Layer[] {
  return [
    new PolygonLayer<{ polygon: [number, number][] }>({
      id: 'land',
      data: [{ polygon: CALIFORNIA_LAND }],
      getPolygon: (d) => d.polygon,
      filled: true,
      getFillColor: [37, 51, 39], // muted forest/terrain green
      stroked: true,
      getLineColor: [70, 96, 82, 200], // coastline
      lineWidthUnits: 'pixels',
      getLineWidth: 1.2,
      pickable: false,
    }),
  ]
}
