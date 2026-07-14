# Basemap — Real Offline Vector Geography (Natural Earth) + Hillshade Toggle

## Context

The Fire Season demo currently renders **no real geography**: `MapCanvas.tsx` uses a flat, tile-less MapLibre style (`FLAT_STYLE`, ocean-blue background) and `terrain.ts` draws a single hand-traced California land polygon. That was a deliberate choice — no Mapbox/OSM tiles — to keep the app **keyless, fully offline, and deterministic**, and to protect the Playwright smoke test, which asserts **zero console errors** while the sim runs (a failed tile fetch in headless CI would trip it).

The operator has no spatial context: no recognizable coastline, water, borders, or cities. Goal: render real geography **underneath the grid** for context, **without** giving up any of the three guarantees above.

**Chosen approach (confirmed with user):**
- **Default basemap** = bundled real **Natural Earth vector features** (coastline, water, borders, city labels) rendered through deck.gl layers — no runtime tiles/network. Upgrades `terrain.ts` in place.
- **Optional hillshade** = a **separate bundled terrain-relief data file**, rendered as a raster layer, exposed via a **toggle at the bottom-right of the map**, available on **both** the User Console and God Mode tabs (shared state). Default **off** (vector-only); toggling on adds shaded relief.

All data is bundled/committed and served same-origin — offline boot, no key, and the zero-error E2E gate all stay intact.

## Approach

Render the basemap as the bottom layers of the existing deck.gl stack (below graticule/bases/drones/fires). Everything is imported/bundled — **no external runtime fetch**.

### 1. Vector data generation (dev-time only → committed GeoJSON)

- New `scripts/build-basemap.mjs` (dev tooling, **not shipped to runtime**): reads Natural Earth 10m source and writes minimal GeoJSON clipped to `BBOX` (from `src/sim/config.ts`, small margin) and simplified (mapshaper visvalingam, ≈500 m tolerance — ~1 px at this zoom).
  - Physical: `ne_10m_land` (coastline/ocean), `ne_10m_lakes` (Shasta, Tahoe, Clear Lake…), `ne_10m_rivers_lake_centerlines` (Sacramento River…).
  - Cultural: `ne_10m_admin_1_states_provinces_lines` (**state borders only** — CA/NV/OR, no counties), `ne_10m_urban_areas`, `ne_10m_populated_places` (kept **in full within the bbox** — label every population center).
  - NE source pulled at generation time from a public-domain mirror (nvkelso/natural-earth-vector or geojson.xyz); optionally `us-atlas` (npm) for state/county lines. Generation network use is **dev-time only**.
- Committed outputs in `src/ui/map/geo/`: `land.json`, `lakes.json`, `rivers.json`, `states.json`, `urban.json`, `places.json`. Est. total **< ~400 KB**.

### 2. Hillshade data generation (dev-time only → separate committed raster)

- New `scripts/build-hillshade.mjs` (dev tooling, separate from the vector script): builds a dark, land-masked hillshade image of the NorCal bbox.
  - Fetch a DEM for `BBOX` (SRTM/USGS 3DEP or AWS terrarium tiles), run `gdaldem hillshade`, apply a dark C2-toned color ramp, and **mask ocean/water to transparent** (using the land polygon) so the ocean background shows through.
  - Output in geographic (lng/lat) extent exactly matching `[BBOX.west, BBOX.south, BBOX.east, BBOX.north]`, downsampled to ~1600×1950 px.
- **Separate committed data file**: `src/ui/map/geo/hillshade.webp` (WebP for size; dark relief compresses well, est. ~0.3–1 MB) — its own file, distinct from the vector GeoJSON. Imported as a vite asset → served **same-origin** at runtime (no external network).

### 3. Render module

- New `src/ui/map/basemap.ts` exporting `basemapLayers(opts: { hillshade: boolean }): Layer[]`, replacing `terrain.ts`. Ordered bottom→top:
  1. **land** — `GeoJsonLayer`, dark olive-green fill `[37,51,39]`, coastline stroke `[70,96,82,200]` (the base surface; stays underneath the hillshade so any transparent gaps still read as land).
  2. **hillshade** (only when `opts.hillshade`) — `BitmapLayer` with `image` = the imported `hillshade.webp`, `bounds: [BBOX.west, BBOX.south, BBOX.east, BBOX.north]`. Land-masked so ocean stays background-blue.
  3. **urban** — `GeoJsonLayer`, subtle gray fill `[58,64,76,110]`.
  4. **lakes** — `GeoJsonLayer`, ocean-blue fill so they read as water.
  5. **rivers** — `GeoJsonLayer`/`PathLayer`, thin blue `[70,110,150]`.
  6. **states** — `GeoJsonLayer` lines from `ne_10m_admin_1_states_provinces_lines`, muted `[80,100,130,140]`. **State borders only** (CA/NV/OR) — no county lines.
  7. **places** — `TextLayer` labeling **every** populated place within `BBOX` (all of `ne_10m_populated_places`, not a curated subset), **deduped against base names** (Redding/Chico/Sacramento/Weed are already labeled by `baseLayers()`). Small dot + name per place; if labels overlap at this zoom, apply deck.gl `CollisionFilterExtension` as a follow-up rather than dropping places.
- Colors matched to the existing dark C2 palette.

### 4. Toggle UI + shared state

- `src/ui/store.ts` (zustand): add `showHillshade: boolean` (default `false`) + `toggleHillshade()`. Because it lives in the shared `useUIStore`, the setting is **shared across both tabs** and persists when switching.
- New `src/ui/map/HillshadeToggle.tsx`: a small C2-styled toggle button (label "Terrain") rendered by the shared view so it appears on **both** tabs. Reads/sets `showHillshade`.
- Position **bottom-right of the map** via a new `.map-toggle` CSS class, absolutely positioned inside `.map-wrap` (left of the 300px side panel), mirroring the existing top-left `.view-title` treatment.

### 5. Wiring

- `src/ui/map/MapCanvas.tsx`: replace both `...terrainLayers()` calls (`:72` truth, `:86` console) with `...basemapLayers({ hillshade: store().showHillshade })`. `rebuild()` already reads `store()` each frame and is subscribed to `useUIStore` changes, so flipping the toggle re-renders immediately (even paused).
- Render `<HillshadeToggle />` in the shared `SimulationView.tsx` (or the `.map-wrap` in `MapCanvas`) so both tabs show it.

## Files

- **new** `scripts/build-basemap.mjs`, `scripts/build-hillshade.mjs` — dev-time generators.
- **new** `src/ui/map/geo/*.json` — clipped/simplified Natural Earth vector features.
- **new** `src/ui/map/geo/hillshade.webp` — separate committed hillshade raster.
- **new** `src/ui/map/basemap.ts` — `basemapLayers({ hillshade })` (replaces `src/ui/map/terrain.ts`).
- **new** `src/ui/map/HillshadeToggle.tsx` — bottom-right map toggle.
- **edit** `src/ui/map/MapCanvas.tsx` — swap in `basemapLayers`, pass hillshade flag.
- **edit** `src/ui/SimulationView.tsx` — mount `<HillshadeToggle />` (shared → both tabs).
- **edit** `src/ui/store.ts` — `showHillshade` + `toggleHillshade`.
- **edit** `src/index.css` — `.map-toggle` (bottom-right); optional ocean-color nudge.
- **edit** `package.json` — devDependency `mapshaper` + DEM/gdal tooling notes + `build:basemap` / `build:hillshade` scripts. Runtime deps unchanged.
- **new** `src/ui/map/basemap.test.ts` — GeoJSON parses, features within `BBOX`, `basemapLayers()` returns the expected layers with/without the hillshade flag.

## Reuse

- `@deck.gl/layers` `GeoJsonLayer` / `PathLayer` / `TextLayer` / `BitmapLayer` (already installed 9.3.x) — no new runtime deps.
- `BBOX` from `src/sim/config.ts` for clipping, bitmap bounds, and label filtering.
- Existing bottom-of-stack layer pattern in `MapCanvas.rebuild()`, the `.view-title` overlay pattern for positioning the toggle, and the `TextLayer` label styling from `baseLayers()`.

## Verification

- `npm run build` (`tsc --noEmit` + `vite build`) green; bundle stays under the 2000 KB warn (hillshade is a same-origin asset, not a JS chunk).
- `npm test` (vitest) — existing suite + new `basemap.test.ts`.
- `npm run test:e2e` (Playwright smoke) — still **zero console errors** (no external network; hillshade loads same-origin); optionally assert the toggle exists on both tabs and flipping it changes the layer set.
- Manual `npm run dev`: on both tabs, real coastline/rivers/lakes/state borders/city labels render under the grid (dark theme); the bottom-right **Terrain** toggle adds/removes shaded relief and the choice carries across tabs; bases/drones/fires stay legible; pan/zoom still re-renders the graticule.

## Notes / trade-offs

- Hillshade is **land-masked** so the ocean stays flat background-blue; toggle default **off** (vector-only baseline).
- The hillshade raster is a fixed-extent image: crisp at bbox scale, softens at extreme zoom (acceptable — operators work at bbox scale). Vector features stay sharp.
- All Natural Earth + DEM fetching is **build tooling only**; the shipped app remains fully offline and keyless, and both `hillshade.webp` and the GeoJSON are served same-origin.
