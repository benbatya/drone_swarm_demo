// LOD graticule: grid lines for the current viewport, snapped to the sim grid
// origin, spacing chosen by zoom. Regenerated on map move (see MapCanvas).
import { lngLatToMeters, metersToLngLat } from '../../sim/geo'

export interface GridLine {
  source: [number, number]
  target: [number, number]
  major: boolean
}

/** Grid line spacing in meters for a given map zoom level. */
export function spacingForZoom(zoom: number): number {
  if (zoom < 9) return 50_000
  if (zoom < 12) return 10_000
  if (zoom < 14.5) return 1_000
  if (zoom < 16.5) return 100
  return 10
}

const MAX_LINES = 600

export function buildGraticule(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
): GridLine[] {
  const spacing = spacingForZoom(zoom)
  const major = spacing * 5 // every 5th line rendered brighter

  const sw = lngLatToMeters(bounds.west, bounds.south)
  const ne = lngLatToMeters(bounds.east, bounds.north)
  const minX = Math.min(sw.x, ne.x)
  const maxX = Math.max(sw.x, ne.x)
  const minY = Math.min(sw.y, ne.y)
  const maxY = Math.max(sw.y, ne.y)

  const lines: GridLine[] = []
  const isMajor = (v: number) => Math.abs(v % major) < spacing / 2

  const startX = Math.floor(minX / spacing) * spacing
  for (let x = startX; x <= maxX; x += spacing) {
    const a = metersToLngLat(x, minY)
    const b = metersToLngLat(x, maxY)
    lines.push({ source: [a.lng, a.lat], target: [b.lng, b.lat], major: isMajor(x) })
    if (lines.length >= MAX_LINES) return lines
  }
  const startY = Math.floor(minY / spacing) * spacing
  for (let y = startY; y <= maxY; y += spacing) {
    const a = metersToLngLat(minX, y)
    const b = metersToLngLat(maxX, y)
    lines.push({ source: [a.lng, a.lat], target: [b.lng, b.lat], major: isMajor(y) })
    if (lines.length >= MAX_LINES) return lines
  }
  return lines
}
