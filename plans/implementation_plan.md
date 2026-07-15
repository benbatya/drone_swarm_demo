# Land-clip the lawnmower scan path

## Goal

Drones on their lawnmower sweep currently fly the full rectangular sector,
including the parts that sit over the Pacific (west-half sectors reach
`x = 0`, the world's west/coastal edge). That wastes flight time scanning ocean
the system isn't responsible for.

**Per the user's clarification:** the scan *area* stays a **rectangle** — we do
**not** shrink `scanSectorFor`. Only the *path* changes: each lawnmower leg is
clipped to the land portion of its row, so the sweep's turnarounds **follow the
coastline (the boundary zone)** instead of running out to sea. Rows that are
entirely ocean are dropped.

## Approach

The single seam is **`buildLawnmower` in `src/sim/directives/scanExec.ts`** — the
sole waypoint generator. It's called from four places that must stay
byte-identical (the console dead-reckons a blacked-out drone by *rebuilding the
same path*):

- `scanExec.ts` `makeScanExec` (initial) and `stepScan` (rebuild on each re-cover)
- `src/sim/snapshot.ts:220` (console ghost reconstruction)
- `src/ui/map/scanZones.ts:57` (map hatch preview)

Because all four call the same pure function with the same `(rect, spacing,
orientation)`, making `buildLawnmower` itself land-aware keeps every call site
consistent automatically — **no call-site changes, no signature change.**

### 1. New land helper — `src/sim/land.ts`

Add one exported function that keeps land logic in the land layer:

```ts
/**
 * Outer on-land extent along `axis` at the fixed cross-coordinate `across`,
 * within [from, to] (meters). Returns [lo, hi] hugging the coastline, or null
 * if the whole span is water. Fails OPEN: if land data didn't load, returns
 * [from, to] (same fallback philosophy as isOnLand).
 */
export function landExtentAlongAxis(
  axis: 'x' | 'y',
  across: number,
  from: number,
  to: number,
): [number, number] | null
```

Implementation — **march + bisection**, reusing the existing `isOnLand`:
- If `POLYS.length === 0` → return `[from, to]` (fail open).
- Step from `from` to `to` in fine increments (recommend `detectionRadiusM / 2`,
  ~5 km; sectors are 90–220 km so this is ~20–45 samples/row, cheap). Build a
  point via `axis === 'x' ? {x:t, y:across} : {x:across, y:t}` and test
  `isOnLand`. (The step needs `detectionRadiusM`; either pass it in or add a
  `landExtentAlongAxis(axis, across, from, to, step)` param so `land.ts` stays
  config-free.)
- Record the first (`lo0`) and last (`hi0`) on-land sample. If none → `null`.
- **Bisection-refine** the two coast crossings to ~100 m: between the water
  sample just before `lo0` and `lo0`, and between `hi0` and the water sample
  just after, ~8 iterations each. This puts the turnaround right on the coast.
- Return `[loRefined, hiRefined]`.

This reuses the tested `isOnLand` rather than adding new polygon-intersection
math. (Alternative, if we later want exact multi-span precision: analytic
scanline over `POLYS` outer rings minus holes. Not needed for the coastal case —
each of these rows is a single land span with the ocean on the west.)

### 2. Land-clip `buildLawnmower` — `src/sim/directives/scanExec.ts`

Rework the row loop to clip each row's leg and drop ocean-only rows:

```ts
const along = horizontal ? 'x' : 'y'
const rows: { across: number; lo: number; hi: number }[] = []
for (let k = 0; k <= n; k++) {
  const across = Math.min(acrossMin + k * spacing, acrossMax)
  const span = landExtentAlongAxis(along, across, alongMin, alongMax, step)
  if (span) rows.push({ across, lo: span[0], hi: span[1] })
}
```

Then stitch a **boustrophedon over the kept rows only**, alternating by
kept-row index and joining each new row from the end nearest the previous row's
last point (so turnarounds stay short and the polyline stays contiguous):

- Row 0: emit `lo → hi` (as `{along, across}` points).
- Row i>0: start from whichever of `{lo, hi}` is nearer the previous emitted
  point; emit that end → the other end.

Keep the existing entry-proximity `reverse()` at the end (unchanged) — it still
orients the whole path toward `entry`, and the heading-derived direction fix in
`snapshot.ts` still applies.

**Fallback / guards:**
- If **no** row has land (`rows.length === 0`) — shouldn't happen for the real
  bases, but defensively rebuild the **full rectangle path** (current behavior)
  so `stepScan` never indexes an empty `waypoints` array. Mirrors the fail-open
  stance.
- A single land span per row is assumed (outer extent). A large bay would be
  overflown rather than woven into — acceptable and arguably desirable at this
  scale; noted as a known simplification.

### 3. Performance / caching

`buildLawnmower` is now heavier (dozens of `isOnLand` ray-casts) and
`snapshot.ts` may rebuild it per emit for each disconnected scanning drone.
The result is deterministic in `(rect, spacing, orientation)`, so **memoize** by
a key of those three (small `Map` in `scanExec.ts`). This keeps the console ghost
path cheap and — because it's the same function — identical across call sites.
(If we skip caching initially, correctness is unchanged; add it if profiling
shows cost.)

## Tests

- **Update** `src/sim/directives/scanExec.test.ts` `maxGap` (L44–49): it asserts
  *every* rect point is within detection radius of the path — no longer true for
  ocean points. Re-scope to "every **on-land** rect point is within detection
  radius," reusing `isOnLand` like `ignition.test.ts:43-52`.
- **New** test: no waypoint lies in the ocean — every `buildLawnmower` waypoint
  satisfies `isOnLand` (within a small coast tolerance), for a known coastal
  sector (a west-half `scanSectorFor` id).
- **New** test: `landExtentAlongAxis` returns `null` for an all-ocean row and a
  sensible `[lo, hi]` for a coastal row.
- **Keep** `scanSectors.test.ts` unchanged — sectors still tile to the borders
  (we did not touch `scanSectorFor`).
- Sanity-check the dead-reckoning tests in `comms.test.ts` still pass (the ghost
  now follows a coast-clipped path, but the assertions are direction/coverage
  based, not exact-rectangle based).

## Verification

1. `npm run build && npm test && npm run test:e2e` (e2e must stay zero-console-error).
2. `npm run dev` and eyeball a west-coast drone (e.g. a Redding/Weed odd-index
   drone): its sweep turnarounds should ride the coastline, no legs out over the
   blue ocean; the sector rectangle overlay is unchanged.
3. Restart the dev server as the final step.

## Open questions

- **Coastal margin:** clip exactly at the coast, or leave a small inland/offshore
  margin (e.g. keep legs `detectionRadiusM` short of the water so the detection
  disc doesn't spill offshore)? Default plan: clip exactly at the coast — the
  detection disc naturally covers the shoreline. Easy to add a margin if desired.
- **Bays:** outer-extent clipping overflies large bays (single span per row). Fine
  for the demo? Or split into multiple on-land spans per row (more code, gaps in
  the polyline the helpers must tolerate)? Default: single span.
- **Caching:** ship the memo in v1, or add only if profiling shows it matters?
