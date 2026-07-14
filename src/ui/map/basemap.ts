import type { Layer } from '@deck.gl/core'
import {
  BitmapLayer,
  GeoJsonLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers'
import type { FeatureCollection } from 'geojson'
import { BASES, BBOX } from '../../sim/config'
import landData from '../../sim/land.json'
import lakesData from './geo/lakes.json'
import placesData from './geo/places.json'
import riversData from './geo/rivers.json'
import statesData from './geo/states.json'
import urbanData from './geo/urban.json'
import hillshadeUrl from './geo/hillshade.webp'

// Bundled Natural Earth vector geography (built offline by scripts/build-basemap.mjs)
// plus an optional bundled hillshade raster (scripts/build-hillshade.mjs). All
// imported/same-origin — the app makes no external tile/style requests.

const fc = (d: unknown) => d as FeatureCollection

// City labels: every populated place in the bbox, minus the four bases (already
// labeled by baseLayers()).
const BASE_NAMES = new Set(BASES.map((b) => b.name.toLowerCase()))
interface Place {
  name: string
  position: [number, number]
}
const PLACES: Place[] = fc(placesData)
  .features.map((f) => ({
    name: String((f.properties as { name?: string })?.name ?? ''),
    position: (f.geometry as unknown as { coordinates: [number, number] }).coordinates,
  }))
  .filter((p) => p.name && !BASE_NAMES.has(p.name.toLowerCase()))

/**
 * Basemap layers, bottom→top: land fill, optional hillshade, urban areas,
 * lakes, rivers, state borders, and population-center labels. Rendered beneath
 * the graticule/bases/drones/fires. Colors match the dark C2 palette.
 */
export function basemapLayers(opts: { hillshade: boolean }): Layer[] {
  const layers: Layer[] = [
    new GeoJsonLayer({
      id: 'land',
      data: landData as never,
      filled: true,
      getFillColor: [37, 51, 39],
      stroked: true,
      getLineColor: [70, 96, 82, 200],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      pickable: false,
    }),
  ]

  // Shaded relief over the flat land fill; transparent over ocean/water.
  if (opts.hillshade) {
    layers.push(
      new BitmapLayer({
        id: 'hillshade',
        image: hillshadeUrl,
        bounds: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
      }),
    )
  }

  layers.push(
    new GeoJsonLayer({
      id: 'urban',
      data: urbanData as never,
      filled: true,
      getFillColor: [58, 64, 76, 110],
      stroked: false,
      pickable: false,
    }),
    new GeoJsonLayer({
      id: 'lakes',
      data: lakesData as never,
      filled: true,
      getFillColor: [10, 26, 46, 255], // ocean color → reads as water
      stroked: true,
      getLineColor: [70, 110, 150, 150],
      lineWidthUnits: 'pixels',
      getLineWidth: 0.6,
      pickable: false,
    }),
    new GeoJsonLayer({
      id: 'rivers',
      data: riversData as never,
      stroked: true,
      filled: false,
      getLineColor: [70, 110, 150, 175],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      pickable: false,
    }),
    new GeoJsonLayer({
      id: 'states',
      data: statesData as never,
      stroked: true,
      filled: false,
      getLineColor: [90, 108, 138, 150],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      pickable: false,
    }),
    // Population centers: dot + name.
    new ScatterplotLayer<Place>({
      id: 'places-dots',
      data: PLACES,
      getPosition: (d) => d.position,
      getRadius: 2,
      radiusUnits: 'pixels',
      radiusMinPixels: 1.5,
      getFillColor: [150, 165, 185, 200],
      pickable: false,
    }),
    new TextLayer<Place>({
      id: 'places-labels',
      data: PLACES,
      getPosition: (d) => d.position,
      getText: (d) => d.name,
      getSize: 10,
      sizeUnits: 'pixels',
      getColor: [150, 165, 185, 220],
      getPixelOffset: [0, -9],
      fontFamily: 'monospace',
      characterSet: 'auto',
      pickable: false,
    }),
  )

  return layers
}
