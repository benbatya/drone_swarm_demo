import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { BASES, type Base } from '../../sim/config'

// Base markers + labels. Fires and drones join these layers in M1+.
export function baseLayers() {
  return [
    new ScatterplotLayer<Base>({
      id: 'bases',
      data: BASES,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 7,
      radiusUnits: 'pixels',
      getFillColor: [56, 132, 255],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: [230, 238, 250],
      pickable: true,
    }),
    new TextLayer<Base>({
      id: 'base-labels',
      data: BASES,
      getPosition: (d) => [d.lng, d.lat],
      getText: (d) => d.name,
      getSize: 12,
      sizeUnits: 'pixels',
      getColor: [210, 224, 240],
      getPixelOffset: [0, -16],
      fontFamily: 'monospace',
      background: true,
      getBackgroundColor: [11, 18, 32, 190],
      backgroundPadding: [4, 2],
    }),
  ]
}
