import type { Layer } from '@deck.gl/core'
import { LineLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { ConsoleDroneView, ConsoleView, FireView } from '../../sim/snapshot'
import type { Staleness } from '../../sim/snapshot'
import type { DraftRect } from '../store'

const STALE_COLOR: Record<Staleness, [number, number, number]> = {
  fresh: [90, 205, 255],
  stale: [255, 180, 84],
  missing: [255, 80, 80],
  unknown: [130, 140, 160],
}

export interface ConsoleLayerOpts {
  onSelectDrone?: (id: string) => void
  onSelectFire?: (cellId: number) => void
  draftRect?: DraftRect | null
}

export function consoleLayers(cv: ConsoleView, opts: ConsoleLayerOpts): Layer[] {
  const layers: Layer[] = []
  const withPos = cv.drones.filter((d) => d.reportedPosition)
  const stale = withPos.filter((d) => d.staleness === 'stale' && d.ghostPosition)

  // Believed fires (console knowledge only).
  layers.push(
    new ScatterplotLayer<FireView>({
      id: 'console-fires',
      data: cv.fires,
      getPosition: (d) => d.position,
      getRadius: 4,
      radiusUnits: 'pixels',
      radiusMinPixels: 2.5,
      getFillColor: [255, 120, 40, 210],
      pickable: !!opts.onSelectFire,
      onClick: opts.onSelectFire
        ? (info) => (info.object ? (opts.onSelectFire!(info.object.cellId), true) : false)
        : undefined,
    }),
  )

  // Uncertainty circles + dead-reckoning path for stale drones.
  layers.push(
    new ScatterplotLayer<ConsoleDroneView>({
      id: 'console-uncertainty',
      data: stale,
      getPosition: (d) => d.ghostPosition!,
      getRadius: (d) => d.uncertaintyRadiusM,
      radiusUnits: 'meters',
      filled: false,
      stroked: true,
      getLineColor: [255, 180, 84, 70],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
    }),
    new LineLayer<ConsoleDroneView>({
      id: 'console-deadreckon',
      data: stale,
      getSourcePosition: (d) => d.reportedPosition!,
      getTargetPosition: (d) => d.ghostPosition!,
      getColor: [255, 180, 84, 150],
      getWidth: 1,
      widthUnits: 'pixels',
    }),
    // Ghost marker (hollow) at the dead-reckoned position.
    new ScatterplotLayer<ConsoleDroneView>({
      id: 'console-ghost',
      data: stale,
      getPosition: (d) => d.ghostPosition!,
      getRadius: 5,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: [255, 180, 84, 220],
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
    }),
  )

  // Last-confirmed markers, colored by staleness (red = MISSING).
  layers.push(
    new ScatterplotLayer<ConsoleDroneView>({
      id: 'console-drones',
      data: withPos,
      getPosition: (d) => d.reportedPosition!,
      getRadius: 6,
      radiusUnits: 'pixels',
      radiusMinPixels: 5,
      getFillColor: (d) => STALE_COLOR[d.staleness],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => (d.staleness === 'missing' ? 2 : 1.5),
      getLineColor: (d) => (d.staleness === 'missing' ? [255, 200, 200] : [10, 16, 28]),
      pickable: true,
      onClick: opts.onSelectDrone
        ? (info) => (info.object ? (opts.onSelectDrone!(info.object.id), true) : false)
        : undefined,
    }),
  )

  // In-progress scan rectangle (shift-drag).
  if (opts.draftRect) {
    const r = opts.draftRect
    const ring: [number, number][] = [
      [r.west, r.south],
      [r.east, r.south],
      [r.east, r.north],
      [r.west, r.north],
    ]
    layers.push(
      new PolygonLayer<{ ring: [number, number][] }>({
        id: 'draft-rect',
        data: [{ ring }],
        getPolygon: (d) => d.ring,
        filled: true,
        getFillColor: [90, 160, 255, 40],
        stroked: true,
        getLineColor: [120, 190, 255, 220],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
      }),
    )
  }

  return layers
}
