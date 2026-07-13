import type { Layer } from '@deck.gl/core'
import { LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { BASES } from '../../sim/config'
import { buildLawnmower } from '../../sim/directives/scanExec'
import { parseDroneId, scanSectorFor } from '../../sim/drones/scanSectors'
import { lngLatToMeters, metersToLngLat } from '../../sim/geo'
import type { ConsoleDroneView, ConsoleView, FireView } from '../../sim/snapshot'
import type { DraftRect } from '../store'
import { stalenessColor } from './colors'

export interface ConsoleLayerOpts {
  onSelectDrone?: (id: string) => void
  onSelectFire?: (cellId: number) => void
  draftRect?: DraftRect | null
  /** Selected drone id — its fixed scan sector + path overlay is drawn in gray. */
  selectedDroneId?: string | null
}

type LL = [number, number]
const toLL = (x: number, y: number): LL => {
  const ll = metersToLngLat(x, y)
  return [ll.lng, ll.lat]
}

/** Gray scan-sector rectangle + lawnmower path for the selected drone (console). */
function scanSectorLayers(id: string): Layer[] {
  const rect = scanSectorFor(id)
  if (!rect) return []
  const ring: LL[] = [
    toLL(rect.minX, rect.minY),
    toLL(rect.maxX, rect.minY),
    toLL(rect.maxX, rect.maxY),
    toLL(rect.minX, rect.maxY),
  ]
  // Enter from the drone's home base, matching its actual autoPatrol path.
  const base = BASES.find((b) => b.id === parseDroneId(id)?.baseId)
  const entry = base ? lngLatToMeters(base.lng, base.lat) : { x: rect.minX, y: rect.minY }
  const path: LL[] = buildLawnmower(rect, entry).map((w) => toLL(w.x, w.y))
  return [
    new PolygonLayer<{ ring: LL[] }>({
      id: 'console-scan-region',
      data: [{ ring }],
      getPolygon: (d) => d.ring,
      filled: true,
      getFillColor: [128, 128, 128, 120], // 50%-transparent gray
      stroked: true,
      getLineColor: [170, 170, 170, 190],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
    }),
    new PathLayer<{ path: LL[] }>({
      id: 'console-scan-path',
      data: [{ path }],
      getPath: (d) => d.path,
      // Lighter gray so the lawnmower path reads on top of the sector fill.
      getColor: [205, 205, 205, 225],
      getWidth: 2,
      widthUnits: 'pixels',
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

const col = (d: ConsoleDroneView, alpha: number): [number, number, number, number] => {
  const [r, g, b] = stalenessColor(d.stalenessFrac)
  return [r, g, b, alpha]
}

export function consoleLayers(cv: ConsoleView, opts: ConsoleLayerOpts): Layer[] {
  const layers: Layer[] = []
  // Selected drone's fixed scan sector + path — drawn first so it sits beneath
  // the fire/drone markers.
  if (opts.selectedDroneId) layers.push(...scanSectorLayers(opts.selectedDroneId))
  const withPos = cv.drones.filter((d) => d.reportedPosition && d.ghostPosition)
  const withGhost = withPos.filter((d) => d.uncertaintyRadiusM > 0)

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
