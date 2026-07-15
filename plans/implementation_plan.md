# Display extinguished-fire locations on the User Console (dark orange)

## Goal

Each drone tracks the fires it has extinguished since its last console sync and
uploads those locations at sync; the **User Console** renders every extinguished
fire location as a **dark-orange** marker.

## Key finding — the drones already track & upload this

Doused fires *already* flow to the console over the existing sync channel:

1. A drone douses a fire in `extinguishExec.ts:35-42` → `markBeliefOut(d, cell,
   now)` sets `believedOut = true` and `updatedAt = now` on the drone's own
   belief entry.
2. At the next successful sync, `uploadFires` (`sync.ts:26-30`) uploads every
   belief entry with `updatedAt > lastSyncAt` — i.e. **exactly the fires
   extinguished since last sync** — and `mergeFire` folds them into
   `w.console.fires` with `believedOut` preserved (out-wins monotonic).
3. `buildConsoleView` (`snapshot.ts:281-289`) then **skips** them:
   `if (kf.believedOut) continue`.

So the "track since last sync + upload" mechanism the request describes is
already implemented via the belief's `updatedAt`/`believedOut` delta — the only
thing missing is **surfacing and rendering** those believed-out fires. This is
also faithful to the sim's C2 premise: the markers are drone-*reported* (gated
by comms/blackouts), not omniscient truth.

## Recommended approach — Option A (reuse the believed-out flow)

Minimal, reuses tested sync/merge, and outcome-correct ("all extinguished fires
the console has heard about"). Three small changes:

### 1. Snapshot — surface extinguished fires (`src/sim/snapshot.ts`)
- Add `extinguishedFires: FireView[]` to `ConsoleView` (lines 92-95).
- In `buildConsoleView`'s fire loop (lines 281-289), instead of `continue` on
  `believedOut`, route those entries into a second list:
  ```ts
  const fires: FireView[] = []
  const extinguishedFires: FireView[] = []
  for (const kf of w.console.fires.values()) {
    const c = cellCenter(kf.cellId)
    const ll = metersToLngLat(c.x, c.y)
    const view = { cellId: kf.cellId, position: [ll.lng, ll.lat], ignitedAt: kf.firstSeenAt }
    ;(kf.believedOut ? extinguishedFires : fires).push(view)
  }
  return { drones, fires, extinguishedFires }
  ```
  (or reuse the existing `firesToViews` helper split by `believedOut`).

### 2. Console rendering — dark-orange layer (`src/ui/map/consoleLayers.ts`)
- Add a sibling `ScatterplotLayer<FireView>` right after `console-fires`
  (lines 39-53):
  ```ts
  new ScatterplotLayer<FireView>({
    id: 'console-extinguished',
    data: cv.extinguishedFires,
    getPosition: (d) => d.position,
    getRadius: 4,
    radiusUnits: 'pixels',
    radiusMinPixels: 2.5,
    getFillColor: [204, 102, 0, 210], // dark orange (same hue family as the
                                      // [255,120,40] active-fire orange, lower value)
  })
  ```
  Draw it **beneath** `console-fires` (push before it) so a re-ignited active
  fire dot sits on top of a stale extinguished marker at the same cell. Not
  pickable (no selection semantics for out fires).

### 3. Types
- `FireView` (`snapshot.ts:56-60`) is reused as-is. No new comms/belief types.

## Alternative — Option B (explicit per-drone delta)

Mirror `abortedIds` literally: add `dousedSinceSync: {cellId, at}[]` to
`DroneTruth` (init in `createFleet`), push at the douse site
(`extinguishExec.ts:41`), add a `dousedFires` map to `ConsoleBelief`, upload it
in a new `uploadDoused` from `stepSync`, clear it in `reconcilePending`, then
surface + render as in Option A. More code and a second channel for data that
already flows via `uploadFires`. Only worth it if we later need to attribute an
extinguished marker to a specific drone or distinguish self-doused from
gossip-learned-out — the console display itself doesn't need either.

**Recommendation: Option A.** It satisfies both halves of the request (delta
upload since last sync + console display) by exposing data that already arrives,
and avoids a redundant telemetry channel.

## Dark orange

`[204, 102, 0]` (≈ `#CC6600`) — same orange hue family as the active-fire
`[255, 120, 40]`, darker (lower value), so "out" reads as a dimmed ember. Alpha
`210` to match the other fire dots. (Exact shade easy to tweak.)

## Tests

- **Snapshot**: mirror `comms.test.ts` "belief isolation" — seed a
  `believedOut` fire into `w.console.fires`, `buildSnapshot`, assert it appears
  in `snap.console.extinguishedFires` (with the right lng/lat) and **not** in
  `snap.console.fires`.
- **End-to-end sim**: mirror `directives.test.ts` "extinguish executor" + a sync
  — set a fire, drone douses it, `tickWorld`/`stepSync` past a sync, assert the
  cell shows up in `snap.console.extinguishedFires`.
- **Active vs out**: a live (not believed-out) fire stays in `snap.console.fires`
  only.
- E2E smoke stays zero-console-error (new layer must not fetch anything).

## Verification

1. `npm run build && npm test && npm run test:e2e`.
2. `npm run dev`, User Console tab: run the sim until drones douse fires, confirm
   dark-orange dots appear at doused cells (active fires stay bright orange), and
   that they're gated by sync (won't appear for a drone still in a blackout).
3. Restart the dev server as the final step.

## Decision — CHOSEN: Option B (explicit per-drone delta)

Implement the explicit per-drone `dousedSinceSync` channel that mirrors
`abortedIds`:

1. `DroneTruth.dousedSinceSync: { cellId: CellId; at: number }[]` — new field,
   init `[]` in `createFleet` (`drone.ts`).
2. Push `{ cellId: exec.cellId, at: now }` at the real douse site
   (`extinguishExec.ts:41`, where this drone drops retardant and extinguishes —
   not the peer-"already out" path).
3. `ConsoleBelief.extinguished: Map<CellId, ExtinguishedFire>` where
   `ExtinguishedFire = { cellId, extinguishedAt, extinguishedBy }`
   (`consoleBelief.ts`), init in `makeConsoleBelief`.
4. `uploadDoused(console, d, now)` in `sync.ts`: fold each `d.dousedSinceSync`
   entry into `w.console.extinguished` (keyed by cellId, `extinguishedBy = d.id`).
   Call it from `stepSync` beside `uploadFires`; clear `d.dousedSinceSync` in
   `reconcilePending` (`d.dousedSinceSync.length = 0`).
5. Snapshot: `ExtinguishedFireView { cellId, position, extinguishedAt }`, added to
   `ConsoleView.extinguishedFires`, built from `w.console.extinguished`.
6. Render: a `ScatterplotLayer` in `consoleLayers.ts` drawn beneath
   `console-fires`, colored with the **extinguishing drone's identity hue** at
   `hsvToRgb(hue, 1, 0.5)` (saturation 1, value 0.5) — the view carries that
   drone's `hue` (looked up by `extinguishedBy`). Known/active fires keep their
   existing `[255,120,40]` orange.

Union across drones covers every doused fire (each is doused by exactly one
drone, which records it), so the console shows all extinguished locations.
