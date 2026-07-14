import type { Layer } from '@deck.gl/core'
import { PathLayer, PolygonLayer } from '@deck.gl/layers'
import { BASES, makeConfig } from '../../sim/config'
import { buildLawnmower, sweepSpacingM } from '../../sim/directives/scanExec'
import { parseDroneId, scanSectorFor } from '../../sim/drones/scanSectors'
import { lngLatToMeters, metersToLngLat } from '../../sim/geo'
import { hsvToRgb, type RGB } from './colors'

// Representative sweep spacing for the zone preview (uses the default config's
// detection radius; the live sim derives the same from its own cfg).
const PREVIEW_SPACING_M = sweepSpacingM(makeConfig())

// A drone's fixed scan zone + lawnmower "hatches", drawn in the drone's own hue.
// Shared by both tabs (God Mode and User Console). Shows the selected drone's
// zone, or every drone's zone when `showAll` is set.

type LL = [number, number]
const toLL = (x: number, y: number): LL => {
  const ll = metersToLngLat(x, y)
  return [ll.lng, ll.lat]
}

export interface ScanDrone {
  id: string
  hue: number
}
interface ZoneDatum {
  hue: number
  ring: LL[]
  path: LL[]
}

function zoneFor(d: ScanDrone): ZoneDatum | null {
  const rect = scanSectorFor(d.id)
  if (!rect) return null
  const ring: LL[] = [
    toLL(rect.minX, rect.minY),
    toLL(rect.maxX, rect.minY),
    toLL(rect.maxX, rect.maxY),
    toLL(rect.minX, rect.maxY),
  ]
  const base = BASES.find((b) => b.id === parseDroneId(d.id)?.baseId)
  const entry = base ? lngLatToMeters(base.lng, base.lat) : { x: rect.minX, y: rect.minY }
  // Preview shows the sector's default (horizontal) sweep; the live drone
  // alternates H/V as it completes passes.
  const orientation = rect.maxX - rect.minX >= rect.maxY - rect.minY ? 'horizontal' : 'vertical'
  const path: LL[] = buildLawnmower(rect, entry, PREVIEW_SPACING_M, orientation).map((w) =>
    toLL(w.x, w.y),
  )
  return { hue: d.hue, ring, path }
}

export interface ScanZoneOpts {
  selectedId?: string | null
  showAll?: boolean
}

export function scanZoneLayers(drones: ScanDrone[], opts: ScanZoneOpts): Layer[] {
  const shown = opts.showAll ? drones : drones.filter((d) => d.id === opts.selectedId)
  const data = shown.map(zoneFor).filter((z): z is ZoneDatum => z != null)
  if (!data.length) return []

  // Dimmer when many zones are shown at once so they don't overwhelm the map.
  const fillA = opts.showAll ? 26 : 42
  const pathA = opts.showAll ? 150 : 215
  const hue = (d: ZoneDatum): RGB => hsvToRgb(d.hue, 1, 1)

  return [
    new PolygonLayer<ZoneDatum>({
      id: 'scan-zones',
      data,
      getPolygon: (d) => d.ring,
      filled: true,
      getFillColor: (d) => [...hue(d), fillA],
      stroked: true,
      getLineColor: (d) => [...hue(d), 165],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      pickable: false,
    }),
    new PathLayer<ZoneDatum>({
      id: 'scan-hatches',
      data,
      getPath: (d) => d.path,
      getColor: (d) => [...hue(d), pathA],
      getWidth: opts.showAll ? 1 : 1.5,
      widthUnits: 'pixels',
      pickable: false,
    }),
  ]
}
