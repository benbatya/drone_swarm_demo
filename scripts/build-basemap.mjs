// Dev-time only. Fetches Natural Earth 10m GeoJSON, clips to the NorCal BBOX,
// simplifies, strips fields, and writes minimal GeoJSON into src/ui/map/geo/.
// The committed outputs are what ship; this script never runs at app runtime.
//
//   npm run build:basemap
//
// Requires devDep `mapshaper`. Network (GitHub raw) needed only at generation
// time; the app itself stays fully offline.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Must match BBOX in src/sim/config.ts.
const BBOX = { west: -124.5, south: 37.8, east: -119.9, north: 42.1 }
const M = 0.3 // small margin so clipped edges sit just outside the view
const bbox = `${BBOX.west - M},${BBOX.south - M},${BBOX.east + M},${BBOX.north + M}`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'src/ui/map/geo')
const CACHE = join(process.env.CLAUDE_JOB_DIR || tmpdir(), 'ne-cache')
const MAPSHAPER = join(root, 'node_modules/.bin/mapshaper')
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'

mkdirSync(OUT, { recursive: true })
mkdirSync(CACHE, { recursive: true })

async function fetchNE(name) {
  const cached = join(CACHE, `${name}.geojson`)
  if (existsSync(cached) && statSync(cached).size > 0) return cached
  process.stdout.write(`  fetch ${name} … `)
  const res = await fetch(`${BASE}/${name}.geojson`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(cached, buf)
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`)
  return cached
}

function ms(inPath, outPath, ...cmds) {
  const args = [inPath, ...cmds.join(' ').split(' ').filter(Boolean), '-o', 'force', outPath]
  execFileSync(MAPSHAPER, args, {
    stdio: ['ignore', 'ignore', 'inherit'],
    maxBuffer: 512 * 1024 * 1024,
  })
  // Stripping all fields makes mapshaper emit a bare GeometryCollection; wrap it
  // back into a standard FeatureCollection (empty props) for predictable loading.
  const gj = JSON.parse(readFileSync(outPath, 'utf8'))
  if (gj.type === 'GeometryCollection') {
    const fc = {
      type: 'FeatureCollection',
      features: gj.geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
    }
    writeFileSync(outPath, JSON.stringify(fc))
  }
}

// out name, source NE layer, mapshaper ops (a -clip is always applied first)
const LAYERS = [
  { out: 'land', src: 'ne_10m_land', ops: '-simplify 12% keep-shapes -filter-fields' },
  { out: 'lakes', src: 'ne_10m_lakes', ops: '-simplify 15% keep-shapes -filter-fields' },
  { out: 'rivers', src: 'ne_10m_rivers_lake_centerlines', ops: '-simplify 12% -filter-fields' },
  { out: 'states', src: 'ne_10m_admin_1_states_provinces_lines', ops: '-simplify 10% -filter-fields' },
  { out: 'urban', src: 'ne_10m_urban_areas', ops: '-simplify 18% keep-shapes -filter-fields' },
  // Points: keep NAME so we can label every population center in the bbox.
  { out: 'places', src: 'ne_10m_populated_places', ops: '-rename-fields name=NAME -filter-fields name' },
]

console.log(`Building basemap GeoJSON → ${OUT}`)
for (const { out, src, ops } of LAYERS) {
  const inPath = await fetchNE(src)
  const outPath = join(OUT, `${out}.json`)
  ms(inPath, outPath, `-clip bbox=${bbox}`, ops)
  const kb = (statSync(outPath).size / 1024).toFixed(0)
  const gj = JSON.parse(readFileSync(outPath, 'utf8'))
  console.log(`  ${out}.json: ${gj.features?.length ?? 0} features, ${kb} KB`)
}
console.log('done.')
