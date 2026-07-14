// Dev-time only. Builds a dark, land-masked hillshade of the NorCal BBOX from
// public terrarium DEM tiles (AWS "elevation-tiles-prod"), and writes it as a
// single WebP (src/ui/map/geo/hillshade.webp). Rendered at runtime by a
// deck.gl BitmapLayer over the BBOX bounds. Ocean is transparent so the flat
// ocean background shows through.
//
//   npm run build:hillshade
//
// Requires devDep `sharp`. Network (DEM tiles) needed only at generation time.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Must match BBOX in src/sim/config.ts.
const BBOX = { west: -124.5, south: 37.8, east: -119.9, north: 42.1 }
const Z = 9 // terrarium zoom (~300 m/px at this latitude)
const REF_LAT = 39.95
const ZFACTOR = 1.6 // vertical exaggeration for readable relief in the dark theme

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'src/ui/map/geo/hillshade.webp')
const CACHE = join(process.env.CLAUDE_JOB_DIR || tmpdir(), 'dem-cache')
const TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
mkdirSync(dirname(OUT), { recursive: true })
mkdirSync(CACHE, { recursive: true })

const rad = (d) => (d * Math.PI) / 180
const N = 2 ** Z
// lng/lat -> global pixel coords (256 px tiles), Web Mercator.
const gpxX = (lng) => ((lng + 180) / 360) * N * 256
const gpxY = (lat) => {
  const s = Math.sin(rad(lat))
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N * 256
}

async function fetchTile(x, y) {
  const p = join(CACHE, `${Z}_${x}_${y}.png`)
  if (existsSync(p) && statSync(p).size > 0) return p
  const res = await fetch(`${TILE}/${Z}/${x}/${y}.png`)
  if (!res.ok) throw new Error(`tile ${Z}/${x}/${y}: HTTP ${res.status}`)
  writeFileSync(p, Buffer.from(await res.arrayBuffer()))
  return p
}

// Stitched elevation grid over the tile range covering the bbox.
const x0 = Math.floor(gpxX(BBOX.west) / 256)
const x1 = Math.floor(gpxX(BBOX.east) / 256)
const y0 = Math.floor(gpxY(BBOX.north) / 256)
const y1 = Math.floor(gpxY(BBOX.south) / 256)
const cols = (x1 - x0 + 1) * 256
const rows = (y1 - y0 + 1) * 256
const originX = x0 * 256
const originY = y0 * 256
console.log(`hillshade: z${Z} tiles x[${x0}..${x1}] y[${y0}..${y1}] → ${cols}×${rows} DEM`)

const elev = new Float32Array(cols * rows)
for (let tx = x0; tx <= x1; tx++) {
  for (let ty = y0; ty <= y1; ty++) {
    const path = await fetchTile(tx, ty)
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 256; px++) {
        const i = (py * 256 + px) * ch
        const e = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768
        const gx = (tx - x0) * 256 + px
        const gy = (ty - y0) * 256 + py
        elev[gy * cols + gx] = e
      }
    }
  }
}

// Output raster over the exact bbox (plate carrée); slight Mercator mismatch at
// this latitude band is negligible for a relief backdrop.
const H = 1600
const W = Math.round((H * (BBOX.east - BBOX.west) * Math.cos(rad(REF_LAT))) / (BBOX.north - BBOX.south))
const sample = (lng, lat) => {
  const fx = gpxX(lng) - originX
  const fy = gpxY(lat) - originY
  const x = Math.max(0, Math.min(cols - 1, fx))
  const y = Math.max(0, Math.min(rows - 1, fy))
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const xi2 = Math.min(cols - 1, xi + 1)
  const yi2 = Math.min(rows - 1, yi + 1)
  const a = elev[yi * cols + xi]
  const b = elev[yi * cols + xi2]
  const c = elev[yi2 * cols + xi]
  const d = elev[yi2 * cols + xi2]
  return a * (1 - xf) * (1 - yf) + b * xf * (1 - yf) + c * (1 - xf) * yf + d * xf * yf
}

// Elevation resampled onto the output grid.
const E = new Float32Array(W * H)
for (let py = 0; py < H; py++) {
  const lat = BBOX.north - (py / (H - 1)) * (BBOX.north - BBOX.south)
  for (let px = 0; px < W; px++) {
    const lng = BBOX.west + (px / (W - 1)) * (BBOX.east - BBOX.west)
    E[py * W + px] = sample(lng, lat)
  }
}

// Horn hillshade → dark green-slate relief; transparent over ocean (elev <= 0).
const cellX = ((BBOX.east - BBOX.west) * 111195 * Math.cos(rad(REF_LAT))) / (W - 1)
const cellY = ((BBOX.north - BBOX.south) * 111195) / (H - 1)
const zenith = rad(90 - 45)
const azimuth = rad(360 - 315 + 90)
const LOW = [22, 30, 26]
const HIGH = [122, 136, 120]
const rgba = Buffer.alloc(W * H * 4)
const at = (px, py) => E[Math.min(H - 1, Math.max(0, py)) * W + Math.min(W - 1, Math.max(0, px))]
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const o = (py * W + px) * 4
    if (E[py * W + px] <= 0) {
      rgba[o + 3] = 0 // ocean → transparent
      continue
    }
    const a = at(px - 1, py - 1), b = at(px, py - 1), c = at(px + 1, py - 1)
    const d = at(px - 1, py), f = at(px + 1, py)
    const g = at(px - 1, py + 1), h = at(px, py + 1), i = at(px + 1, py + 1)
    const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellX)
    const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellY)
    const slope = Math.atan(ZFACTOR * Math.hypot(dzdx, dzdy))
    const aspect = Math.atan2(dzdy, -dzdx)
    let hs =
      Math.cos(zenith) * Math.cos(slope) +
      Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect)
    hs = Math.max(0, Math.min(1, hs))
    rgba[o] = Math.round(LOW[0] + (HIGH[0] - LOW[0]) * hs)
    rgba[o + 1] = Math.round(LOW[1] + (HIGH[1] - LOW[1]) * hs)
    rgba[o + 2] = Math.round(LOW[2] + (HIGH[2] - LOW[2]) * hs)
    rgba[o + 3] = 255
  }
}

await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 82, alphaQuality: 90 })
  .toFile(OUT)
console.log(`wrote ${OUT}: ${W}×${H}, ${(statSync(OUT).size / 1024).toFixed(0)} KB`)
