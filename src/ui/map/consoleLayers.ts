import type { Layer } from '@deck.gl/core'
import { LineLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { lngLatToMeters, metersToLngLat } from '../../sim/geo'
import type {
  ConsoleDroneView,
  ConsoleView,
  ExtinguishedFireView,
  FireView,
} from '../../sim/snapshot'
import type { DraftRect } from '../store'
import { hsvToRgb, staleValue } from './colors'

export interface ConsoleLayerOpts {
  onSelectDrone?: (id: string) => void
  onSelectFire?: (cellId: number) => void
  draftRect?: DraftRect | null
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

// The drone's signature hue, darkened by its staleness fraction (fades toward
// black as the contact gap approaches MISSING, restored on the next sync).
const col = (d: ConsoleDroneView, alpha: number): [number, number, number, number] => {
  const [r, g, b] = hsvToRgb(d.hue, 1, staleValue(d.stalenessFrac))
  return [r, g, b, alpha]
}

export function consoleLayers(cv: ConsoleView, opts: ConsoleLayerOpts): Layer[] {
  const layers: Layer[] = []
  const withPos = cv.drones.filter((d) => d.reportedPosition && d.ghostPosition)
  const withGhost = withPos.filter((d) => d.uncertaintyRadiusM > 0)

  // Extinguished fires the console has been told about — tinted with the
  // extinguishing drone's identity hue at half brightness (value 0.5, full
  // saturation). Drawn beneath live fires so a re-ignition at the same cell
  // sits on top.
  layers.push(
    new ScatterplotLayer<ExtinguishedFireView>({
      id: 'console-extinguished',
      data: cv.extinguishedFires,
      getPosition: (d) => d.position,
      getRadius: 4,
      radiusUnits: 'pixels',
      radiusMinPixels: 2.5,
      getFillColor: (d) => {
        const [r, g, b] = hsvToRgb(d.hue, 1, 0.5)
        return [r, g, b, 210]
      },
    }),
  )

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

  layers.push(
    // Position-uncertainty circle at the dead-reckoned estimate — grows with staleness.
    new ScatterplotLayer<ConsoleDroneView>({
      id: 'console-uncertainty',
      data: withGhost,
      getPosition: (d) => d.ghostPosition!,
      getRadius: (d) => d.uncertaintyRadiusM,
      radiusUnits: 'meters',
      filled: true,
      getFillColor: (d) => col(d, 22),
      stroked: true,
      getLineColor: (d) => col(d, 90),
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
    }),
    // Dead-reckoning path: last-confirmed → estimated-now.
    new LineLayer<ConsoleDroneView>({
      id: 'console-deadreckon',
      data: withGhost,
      getSourcePosition: (d) => d.reportedPosition!,
      getTargetPosition: (d) => d.ghostPosition!,
      getColor: (d) => col(d, 150),
      getWidth: 1,
      widthUnits: 'pixels',
    }),
    // Extrapolated heading tick at the estimated position.
    new LineLayer<ConsoleDroneView>({
      id: 'console-heading',
      data: withPos,
      getSourcePosition: (d) => d.ghostPosition!,
      getTargetPosition: (d) => headingEndpoint(d.ghostPosition!, d.heading ?? 0, 9000),
      getColor: (d) => col(d, 200),
      getWidth: 1.5,
      widthUnits: 'pixels',
    }),
    // Last-confirmed marker (dim hollow ring).
    new ScatterplotLayer<ConsoleDroneView>({
      id: 'console-reported',
      data: withGhost,
      getPosition: (d) => d.reportedPosition!,
      getRadius: 4,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: (d) => col(d, 120),
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
    }),
    // Estimated current position (filled, colored by staleness) — selectable.
    new ScatterplotLayer<ConsoleDroneView>({
      id: 'console-drones',
      data: withPos,
      getPosition: (d) => d.ghostPosition!,
      getRadius: 6,
      radiusUnits: 'pixels',
      radiusMinPixels: 5,
      getFillColor: (d) => col(d, 255),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      getLineColor: [10, 16, 28],
      pickable: true,
      onClick: opts.onSelectDrone
        ? (info) => (info.object ? (opts.onSelectDrone!(info.object.id), true) : false)
        : undefined,
    }),
    new TextLayer<ConsoleDroneView>({
      id: 'console-labels',
      data: withPos,
      getPosition: (d) => d.ghostPosition!,
      getText: (d) => d.id,
      getSize: 10,
      sizeUnits: 'pixels',
      getColor: (d) => col(d, 235),
      getPixelOffset: [0, -13],
      fontFamily: 'monospace',
    }),
  )

  // Pending scan-zone redefinitions: the operator has submitted a new sector but
  // the drone hasn't downloaded it yet. Draw it as a bright bounding rectangle in
  // the drone's hue; it clears automatically once the drone adopts it at sync.
  const pending = cv.drones
    .filter((d) => d.pendingSectorRect)
    .map((d) => {
      const r = d.pendingSectorRect!
      const c0 = metersToLngLat(r.minX, r.minY)
      const c1 = metersToLngLat(r.maxX, r.maxY)
      const ring: [number, number][] = [
        [c0.lng, c0.lat],
        [c1.lng, c0.lat],
        [c1.lng, c1.lat],
        [c0.lng, c1.lat],
      ]
      return { hue: d.hue, ring }
    })
  if (pending.length) {
    layers.push(
      new PolygonLayer<{ hue: number; ring: [number, number][] }>({
        id: 'pending-scan-zone',
        data: pending,
        getPolygon: (d) => d.ring,
        filled: true,
        // Bright, near-white tint of the drone's hue so it clearly reads as an
        // unconfirmed operator request, distinct from the confirmed zone overlay.
        getFillColor: (d) => [...hsvToRgb(d.hue, 0.45, 1), 45],
        stroked: true,
        getLineColor: (d) => [...hsvToRgb(d.hue, 0.35, 1), 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
      }),
    )
  }

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
