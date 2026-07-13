import type { Layer } from '@deck.gl/core'
import { ScatterplotLayer, TextLayer, LineLayer } from '@deck.gl/layers'
import { BASES, type Base } from '../../sim/config'
import { lngLatToMeters, metersToLngLat } from '../../sim/geo'
import type { DroneView, FireView } from '../../sim/snapshot'

// Base markers + labels.
export function baseLayers(): Layer[] {
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

// Active fires (ground truth: orange dots).
export function fireLayer(
  fires: FireView[],
  onSelect?: (cellId: number) => void,
): Layer[] {
  return [
    new ScatterplotLayer<FireView>({
      id: 'fires',
      data: fires,
      getPosition: (d) => d.position,
      getRadius: 4,
      radiusUnits: 'pixels',
      radiusMinPixels: 2.5,
      getFillColor: [255, 120, 40, 225],
      stroked: false,
      pickable: !!onSelect,
      onClick: onSelect
        ? (info) => {
            if (info.object) {
              onSelect(info.object.cellId)
              return true
            }
            return false
          }
        : undefined,
    }),
  ]
}

/** Endpoint `dist` meters from `pos` along compass bearing `heading`. */
function headingEndpoint(
  pos: [number, number],
  heading: number,
  dist: number,
): [number, number] {
  const m = lngLatToMeters(pos[0], pos[1])
  const e = { x: m.x + Math.sin(heading) * dist, y: m.y + Math.cos(heading) * dist }
  const ll = metersToLngLat(e.x, e.y)
  return [ll.lng, ll.lat]
}

const DRONE_FILL: Record<DroneView['status'], [number, number, number]> = {
  airborne: [90, 205, 255],
  docked: [150, 160, 180],
  crashed: [255, 80, 80],
}

export interface DroneLayerOpts {
  showDetection: boolean
  detectionRadiusM: number
  onSelect?: (id: string) => void
}

// Drones: detection circles (God Mode), heading ticks, and status-colored dots.
export function droneLayers(drones: DroneView[], opts: DroneLayerOpts): Layer[] {
  const airborne = drones.filter((d) => d.status === 'airborne')
  const layers: Layer[] = []

  if (opts.showDetection) {
    layers.push(
      new ScatterplotLayer<DroneView>({
        id: 'detection',
        data: airborne,
        getPosition: (d) => d.position,
        getRadius: opts.detectionRadiusM,
        radiusUnits: 'meters',
        filled: false,
        stroked: true,
        getLineColor: [90, 205, 255, 40],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
      }),
    )
  }

  layers.push(
    new LineLayer<DroneView>({
      id: 'drone-heading',
      data: drones.filter((d) => d.status !== 'crashed'),
      getSourcePosition: (d) => d.position,
      getTargetPosition: (d) => headingEndpoint(d.position, d.heading, 9000),
      getColor: [120, 210, 255, 190],
      getWidth: 1.5,
      widthUnits: 'pixels',
    }),
    new ScatterplotLayer<DroneView>({
      id: 'drones',
      data: drones,
      getPosition: (d) => d.position,
      getRadius: 6,
      radiusUnits: 'pixels',
      radiusMinPixels: 5,
      getFillColor: (d) => DRONE_FILL[d.status],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      getLineColor: [10, 16, 28],
      pickable: true,
      onClick: opts.onSelect
        ? (info) => {
            if (info.object) {
              opts.onSelect!(info.object.id)
              return true
            }
            return false
          }
        : undefined,
    }),
  )

  return layers
}
