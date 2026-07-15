# Fire Season Drone Swarm — System Design

> Durable design reference for the codebase, meant to onboard a future session
> quickly. It describes the system **as built** (branch `main`). Values here are
> the real defaults in `src/sim/config.ts`; when in doubt, that file wins.
>
> Note on the other docs: `plans/implementation_plan.md` is a **per-feature
> working plan** (overwritten per PR — it never describes `main` as shipped), and
> `plans/initial_design.md` is the original abstract C2 thinking doc. `README.md`
> is the user-facing overview. **This file is the durable architecture reference.**

## 1. What it is

A browser SPA simulating a 30-day forest-fire-fighting season in Northern
California. 8 autonomous drones detect and extinguish randomly-igniting fires
under an intent-based directive system, over an **unreliable console↔drone comms
link**. The whole point is the gap between **truth** and **belief**: the console
is a lens, never in the control loop, and it must never render stale data as if
it were live.

This is made literal by two tabs sharing one view component:

- **User Console** — only what the console has *heard* (successful syncs +
  operator input): last-known positions, dead-reckoned "ghosts", staleness cues,
  drones gone MISSING during a blackout.
- **God Mode** — ground truth: real drone/fire state, comms blackout timelines,
  the true score.

## 2. Stack

Vite 8 · React 19 · TypeScript · **MapLibre GL 5** basemap + **deck.gl 9**
(`MapboxOverlay`, interleaved) for all overlays · **zustand 5** for UI state ·
**vitest 4** (headless sim/units) + **Playwright** (browser smoke). Fully offline
/ keyless: no map tiles are fetched (a flat ocean style + bundled Natural Earth
GeoJSON basemap). Determinism from a seeded mulberry32 PRNG.

## 3. Architecture — two worlds, one bridge

```
GroundTruth (authoritative sim)
   │  detection → writes only the drone's OWN belief
   ▼
DroneBelief (per drone: own detections + peer gossip + downloaded console fires)
   │  gossip (drone↔drone, blackout-independent)
   │
   │  sync (comms/ is the ONLY code that reads truth and writes console belief)
   ▼
ConsoleBelief (only successful syncs + operator input)
   ▼
buildConsoleView → User Console tab
```

- **`src/sim/` is pure TypeScript** — no React, no DOM, no `requestAnimationFrame`.
  The *sole* exception is `simRunner.ts`, which owns the rAF loop. Everything else
  is headless-testable in vitest.
- **Belief isolation** is a hard invariant (and a test): `ConsoleBelief` is
  mutated only by the sync path (`comms/sync.ts`) and operator input
  (`consoleBelief.addPending`). A drone's belief is mutated only by its own
  detection, gossip, and console downloads. Nothing in the belief/UI layers reads
  ground truth directly.

## 4. Coordinates & grid (`src/sim/geo.ts`, `config.ts`)

- Local **equirectangular meters** plane, origin = SW corner of the bbox
  (`lat 37.8, lng −124.5`), longitude scaled by `cos(REF_LAT=39.95°)`. Distortion
  < ~2.7%, self-consistent (render uses the exact inverse). `M_PER_DEG = 111195`.
- BBOX `lat 37.8–42.1, lng −124.5…−119.9` → world ≈ **392 km × 478 km**.
- Sparse **10 m grid**: `GRID_COLS ≈ 39,206`, `GRID_ROWS ≈ 47,814`,
  `cellId = cy*GRID_COLS + cx` (max ~1.9e9, safe integer). Only fires ever occupy
  cells — there is never a dense grid array. Helpers: `lngLatToMeters` /
  `metersToLngLat`, `cellOf`, `toCellId`, `cellCenter`, `distance` (Euclidean),
  `clampToWorld`.
- Heading is radians, **0 = north, clockwise**, i.e. direction vector
  `(sin h, cos h)` ⇒ `h = atan2(dx, dy)`.

## 5. Simulation model

### 5.1 Tick pipeline (`world.ts` `tickWorld(w, rng)`, 1 tick = 1 sim-minute)

1. `w.tick++`.
2. **Ignition** — `stepIgnition`: Poisson(λ) new fires on land cells, never within
   `baseExclusionM` (1000 m) of a base; fires don't spread and persist until doused.
3. **Per-drone** (skips `crashed`):
   - if airborne: `applyFuelPolicy` (may install a forced-RTB override).
   - `pickActive` selects the active executor by **arbitration order**:
     `override` → `operator` (queue head) → `auto` (self-engage) → `patrol`.
   - `stepExec` moves the drone; on `done`, clears that slot.
   - if airborne: burn `fuelBurnLPerMin`; **fuel ≤ 0 → `crashed`** (frozen, `crashedAt`
     set, excluded from everything after); else `stepDetection`.
4. **Gossip** — `stepGossip` (intra-swarm mesh; blackout-independent).
5. **Sync** — `stepSync` (the console C2 link).
6. **Scoring** — `accrue`: `fireMinutes += active fire count`. Doused fires are
   deleted from `w.fires`, so the map's `size` *is* the active count — nothing
   lingers to be double-counted.

`GroundTruth = { cfg, tick, fires: Map<CellId,FireTruth>, drones: DroneTruth[],
score, console: ConsoleBelief }`.

### 5.2 Key parameters (`config.ts` `BASE_CONFIG`)

| Param | Value | Notes |
|---|---|---|
| `dronesPerBase` | 2 | → 8 drones over 4 bases |
| `speedMPerMin` | 1680 | 100.8 km/h |
| `detectionRadiusM` | **10_000** (10 km) | sweep spacing = 2× = 20 km |
| `gossipRangeM` | 50_000 (50 km) | |
| `fuelCapacityL` / `fuelBurnLPerMin` | 2000 / **2.8** | fixed burn ⇒ ~714 min ≈ 1200 km endurance |
| `lowFuelFloorL` | 120 | hard forced-RTB floor |
| `rtbSafetyFactor` / `rtbMarginKm` | 1.25 / 25 | distance-aware RTB trigger |
| `retardantLoads` | 10 | 1 drop = 1 fire |
| `turnaroundMin` | 60 | dock refuel+rearm |
| `ignitionLambdaPerMin` | 1/60 | ~1 fire/hour |
| `autoEngageRangeKm` | 168 | idle self-engage cutoff |
| `patrolBoxKm` | 200 | fallback only (real drones use fixed sectors) |
| `syncCadenceMin` | 32 | normal sync interval |
| `syncRetryMin` | **3** | constant re-poll while dark (NOT exponential backoff) |
| `missingThresholdMin` | **76** | sized above worst routine gap, below min deep outage |
| `staleThresholdMin` | 40 | amber cue |
| `connMin/Max` | 15 / 35 | connected windows |
| `routineDarkMin/Max` | 10 / 40 | routine outages |
| `deepOutageProb` + `deepDarkMin/Max` | 0.05 · 80 / 220 | rare deep outages |
| `seed` | 1337 | `BASE_CONFIG` default; **the browser boot randomizes it** — see below |

Time: `TICKS_PER_DAY=1440`, `TICKS_PER_SEASON=43_200` (≈24 min wall-clock at ×1
and 30 fps). Speed multipliers `[1, 30, 180, 480, 960, 1800]` with
`DEFAULT_SPEED = 480` — the sim **fast-forwards on load** rather than running
true-realtime; `MAX_TICKS_PER_FRAME=600`. Bases: Redding, Chico, Weed, Sacramento.

**Boot seed randomization** — `main.tsx` builds the runner with
`makeConfig({ seed: randomSeed() })`, so **every page load is a different fire
season**. The draw lives in a UI-layer helper (`src/ui/randomSeed.ts`,
`Math.floor(Math.random()×2³²)`) to keep `src/sim/` pure — the sim is still
deterministic given its seed. `BASE_CONFIG.seed` (1337) is untouched, so headless
tests (which pass explicit seeds) are unaffected, and `restart()` ("Run another
season") replays the boot seed; God Mode's `ConfigPanel` can set an explicit seed
to reproduce a run.

## 6. Drones, directives, autonomy

### 6.1 `DroneTruth` (`drones/drone.ts`)

`id, homeBaseId, homePos, pos, heading, fuelL, retardant,
status: 'airborne'|'docked'|'crashed', crashedAt?, dockRemainingMin,
belief, comms, queue: Directive[], exec, execDirId, scanProgress (resume state),
override: RtbExec|null, forcedRtb, patrolRect (current standing scan sector —
operator-redefinable, defaults to the fixed per-drone sector), autoPatrol: ScanExec
(sweeps patrolRect), autoExec,
scanOrientation: 'horizontal'|'vertical', scanFrac, abortedIds[],
dousedSinceSync[] (cells doused since last sync), extinguishedTotal (running
lifetime count)`.

`createFleet` ids are `${baseId}-${i+1}`; all start airborne, full. Comms uses a
**separate forked RNG stream** (`seed ^ 0x5eed`) so blackout draws don't perturb
ignition.

### 6.2 Directives & queue (`directives/`)

- Three kinds: `scan {rect, durationMin}`, `extinguish {cellId}`, `rtb {baseId}` —
  each with `id, importance (1–10, default 5), issuedAt`.
- `queue.ts`: sort = **importance desc, then issuedAt asc**. Higher-importance
  arrival **preempts** the running exec; a preempted scan stashes `elapsedMin` in
  `scanProgress` and resumes; non-scan execs restart. `completeHead` pops on done;
  `abortHead` pops + records into `abortedIds` (reported at next sync so the console
  prunes it).

### 6.3 Executors (`directives/*Exec.ts`)

- **Scan (lawnmower)** `stepScan`: fly waypoints; on finishing a pass, **flip
  orientation** (H↔V) and rebuild — so scans re-cover and autoPatrol runs forever
  (`durationMin = Infinity`). Updates `scanFrac`. Done at `elapsedMin ≥ durationMin`.
- **Extinguish** `stepExtinguish`: fly to `cellCenter`; within `DROP_RADIUS_M=50`
  → extinguish fire, `score.doused++`, `retardant−1`, mark own belief out, and
  **log the cell to `dousedSinceSync` + bump `extinguishedTotal`** (both reported
  to the console at the next sync). If the fire is already gone on arrival →
  complete without dropping.
- **RTB** `stepRtb`: transit → dock (`status='docked'`, `dockRemainingMin=60`) →
  countdown → refuel/rearm to full → airborne, done.

### 6.4 Autonomy & fuel policy

- **Idle behavior** (no override, empty queue): if `retardant > 0` and a known
  active fire is within **168 km** → self-assign an extinguish on the nearest
  (`autoExec`); else fly **autoPatrol** over the drone's standing scan sector
  (`patrolRect`, operator-redefinable — §6.5). Re-evaluated
  each tick — drops the target if a peer douses it (belief flips out).
- **`applyFuelPolicy`**: forced RTB when `retardant ≤ 0`, or `fuelL < 120`, or
  remaining range `≤ distToNearestBase×1.25 + 25 km`. Installs an `override` RtbExec
  to the nearest base and aborts the current queued directive. A drone stranded
  beyond its range still **crashes** at fuel 0.

### 6.5 Scan sectors — **default fixed per-drone, operator-redefinable** (`drones/scanSectors.ts`)

`scanSectorFor(id)` derives a **static default rectangle per drone** from the base
layout: latitude band = halfway to the neighboring bases (or bbox border); longitude
split by index — **`-1` = west half, `-2` = east half** of the base's column.
`defaultSectorFor(id, home, cfg) = scanSectorFor(id) ?? homeSectorRect(home,
patrolBoxKm)` (`patrolBoxKm` is only a fallback for exotic fleet configs). A drone's
**live** sector is `DroneTruth.patrolRect` (initialized to the default);
`setPatrolSector(d, rect, cfg)` overwrites it and rebuilds `autoPatrol`.

**Operators can now persistently redefine a drone's standing scan zone** (PR #35):
a shift-drag on the User Console pushes a `PendingSector` that the drone adopts —
comms-gated, belief-lagged — at its next successful sync (§7), and reports back so
the console believes it. `rect: null` restores the default sector. (The *bounded*
`scan` directive kind still exists in the model/executors but the composer no longer
issues it — the scan action redefines the standing sector instead.) Because both the
sim and the belief-isolated console can compute the *default* from the id alone, a
never-contacted console drone still reconstructs a plausible sweep; once contacted,
the console dead-reckons off the drone's **reported** `patrolRect`.

Lawnmower (`scanExec.ts`): `sweepSpacingM = 2×detectionRadiusM = 20 km`;
`buildLawnmower` is boustrophedon, entering from the nearest end. Each leg is
**clipped to land** (`landExtentAlongAxis` in `land.ts`, coastline-refined by
bisection) so the sweep's turnarounds follow the coast instead of running out
over the Pacific; rows entirely over water are dropped (fail-open to the full
rectangle if a sector holds no land). The clipped shape is deterministic in
`(rect, spacing, orientation)` and **memoized**, so the console's blackout
reconstruction and the map hatches stay byte-identical to the drone's truth.
Path helpers: `pathLength`, `pointAtDistance(s)`, `nearestArcLength(p)`, and
`headingAtDistance(pts, s)` (the polyline tangent — used to dead-reckon a scanning
drone's *heading* along its sweep).

## 7. Comms & belief (`comms/`, `belief/`)

- **Blackouts** (`blackout.ts`): per drone, alternating connected `U(15,35)` and
  dark windows; each dark window is a **deep outage** with prob 0.05 (`U(80,220)`)
  else **routine** (`U(10,40)`). Blended dark fraction ≈ 56%. `isDarkAt` uses a
  monotonic cursor. First sync staggered across the first cadence.
- **Sync** (`sync.ts` `stepSync`, drone-initiated): docked drones are **hard-lined**
  (always connected, refresh every tick). Airborne: at `nextSyncAt`, if dark →
  reschedule `now + syncRetryMin` (constant **3-min re-poll**, deliberately not
  backoff, so a drone reconnects promptly and routine outages can't stack past the
  missing threshold). On success: upload telemetry (`pos, heading, fuel, retardant,
  status, forcedRtb, currentDirectiveKind, queueLen, scanning, scanOrientation,
  patrolRect, extinguishedTotal`) + fire delta (`updatedAt > lastSyncAt`) +
  **doused-fire locations** (`dousedSinceSync` → `ConsoleBelief.extinguished`, then
  cleared), reconcile/prune pendings, **download new operator directives *and* any
  pending scan-sector redefinition** (`pendingSector`: apply `rect ?? defaultSectorFor`
  via `setPatrolSector`, stamp `downloadedAt`), then `nextSyncAt = now + 32`.
- **Gossip** (`gossip.ts`): every airborne pair within `gossipRangeM` (50 km)
  exchanges fire beliefs both ways; blackout-independent (the intra-swarm mesh).
- **Merge** (`merge.ts` `mergeFire`): dedupe by `cellId`; `believedOut` is monotonic
  (out-wins); else newest `updatedAt` wins; `firstSeenAt` = min. Idempotent +
  commutative (tested).
- **`KnownFire`** `{cellId, firstSeenAt, source:'self'|'gossip'|'console',
  believedOut, updatedAt}`. **`ConsoleDroneRecord`** `{id, lastContactAt,
  reported | null, pending[], pendingSector | null}` — `reported.patrolRect` carries
  the last-heard sector; **`PendingSector`** `{rect: RectM|null, issuedAt,
  downloadedAt}` is the operator's latest not-yet-downloaded redefinition
  (`addPendingSector`, latest wins; `null` rect = restore default).
  **`ConsoleBelief.extinguished`**
  `Map<CellId, ExtinguishedFire{cellId, extinguishedAt, extinguishedBy}>`
  accumulates the doused locations drones report (keyed by cell, latest wins).

### Staleness & dead-reckoning (`snapshot.ts buildConsoleView`)

- `age = tick − lastContactAt` → **fresh** ≤ 40 < **stale** ≤ 76 < **MISSING**
  (`unknown` if never contacted). Sizing: worst-case routine contact gap ~75 min
  (≤32 staleness + ≤40 dark + ≤3 re-poll) sits below 76; deep outages (≥80) and
  crashes are the only things that trip MISSING.
- A single age→scalar ramp drives every console fade: `snapshot.ts` computes
  `stalenessFrac = min(age/76, 1)` once (0 = fresh … 1 = MISSING, denominator =
  the MISSING threshold). The UI marker brightness is just its inverse —
  `staleValue(stalenessFrac) = 1 − stalenessFrac` (`colors.ts`) — so panels and
  map layers darken to black exactly as a drone trips MISSING.
- Ghost (dead-reckoned) position: `dist = speed×age`, uncertainty radius
  `= speed×age×0.3`. If the drone was **scanning**, reconstruct the lawnmower over
  its **reported `patrolRect`** (fall back to `scanSectorFor(id)`), anchor at the
  nearest arc-length to the last fix, and step `dist`
  **in the drone's true travel direction** — chosen from the *reported heading*,
  because `buildLawnmower`'s entry-based orientation can otherwise reverse the
  reconstructed path and run the ghost backwards along the sweep — wrapping around
  the loop, and set the **ghost heading from the sweep tangent**
  (`headingAtDistance`) rather than freezing the last reported heading. Otherwise
  project straight along the reported heading.

## 8. Snapshots & runner

- **`snapshot.ts`**: `buildSnapshot` → `TruthSnapshot` (God Mode: full drone/fire
  truth, score, `mode` per drone, `DroneView.scanRect = patrolRect`, plus an embedded
  `ConsoleView`). `buildConsoleView` → belief view (ghosts, staleness,
  pending/downloaded counts, extinguished-fire markers tinted by the extinguishing
  drone's hue + a per-drone extinguished count). Each `ConsoleDroneView` also carries
  `scanRect` (last reported sector, drives the confirmed-zone overlay) and
  `pendingSectorRect` (the operator's not-yet-downloaded sector — a redefine's rect,
  or the default sector for a restore — cleared the instant the drone downloads it).
- **`simRunner.ts SimRunner`**: owns the world and the single rAF loop. Per frame:
  accumulate `dt×speed/60` ticks (capped 600), run `tickWorld` that many times,
  `frameCount++`, rebuild snapshots, push to the **per-frame map channel**
  (imperative `deck.gl` — bypasses React) and a **throttled ~4 Hz store channel**
  (`useSyncExternalStore`, for panels). At season end it pauses. Exposes
  `window.__SIM__ = {frameCount, tickCount, running, drone0, activeFires}` for the
  Playwright smoke. `stepTicks(n)` runs headless; `reconfigure/restart` rebuild the
  world; `issueDirective` = `addPending`; `setScanSector(id, rect|null)` =
  `addPendingSector` (operator sector redefinition, `null` = restore default);
  `getBlackout(id)` feeds the God timeline.

## 9. UI (`src/ui/`)

- **App / tabs**: `User Console` (`source='console'`) and `God Mode`
  (`source='truth'`), both render one `SimulationView`. The header carries an
  **About** button. `store.ts` (zustand): `activeTab` (default console), `selection`,
  `draftRect`, `showHillshade` (on), `showAllScans` (on), and `showAbout` /
  `aboutByDefault` (the About dialog — see below).
- **About dialog** (`panels/AboutDialog.tsx`): explains the truth/belief C2 premise
  and the two tabs (adapted from §1). **Opens on load** iff the persisted
  `aboutByDefault` preference is on (`localStorage` key
  `fireSeason.showAboutByDefault`, default true, toggled by a "Display by default"
  checkbox); the header button reopens it. Dismissed via the button, backdrop click,
  or Escape. All storage access is `try/catch`ed so private-mode failures degrade
  gracefully.
- **Map** (`MapCanvas.tsx`): MapLibre `Map` + deck.gl `MapboxOverlay(interleaved)`.
  `FLAT_STYLE` = single ocean-blue background (offline, no tiles). Center =
  world center, zoom 5.4. **Shift-drag on the console tab draws a `draftRect` that,
  on release, redefines the selected drone's standing scan zone** (§6.5). MapLibre's
  built-in shift-drag `boxZoom` is disabled so the gesture sets the sector instead of
  zooming into the rectangle.
- **Layers**: `basemap.ts` (bundled Natural Earth land/urban/lakes/rivers/states/
  places + optional `hillshade.webp` BitmapLayer) · `graticule.ts` (LOD grid:
  50 km/10 km/1 km/100 m/10 m by zoom, ≤600 lines) · `layers.ts` (God: base dots,
  fire dots, drone dots + detection circles + heading ticks + id labels) ·
  `consoleLayers.ts` (belief: last-confirmed hollow ring, ghost dot, reported→ghost
  dead-reckon line, sweep-extrapolated heading tick, growing uncertainty circle,
  extinguished-fire dots tinted with the extinguishing drone's hue at half
  brightness, color darkened by staleness, plus a **`pending-scan-zone`** bright
  near-white bounding rectangle in the drone's hue for a `pendingSectorRect` — an
  operator sector redefinition the drone hasn't downloaded yet; it clears the instant
  the drone adopts it) · `scanZones.ts` (sector polygons + land-clipped lawnmower
  hatches; the polygon honors each drone's current `scanRect` — the operator-redefined
  sector — falling back to the fixed `scanSectorFor(id)`; the hatches follow each
  drone's **current sweep orientation** and flip H↔V with it — God Mode off the live
  `scanOrientation`, the console off the last *reported* one, falling back to the
  sector's default sweep for a never-contacted drone). `colors.ts`: `staleValue(stalenessFrac)=1−stalenessFrac` (the inverse
  of the sim's `stalenessFrac` — see §7).
- **Panels**: `GodPanel` (ConfigPanel + full fleet list + `DronePanelTruth` w/
  `BlackoutStrip` comms timeline + `FirePanel`). `ConsolePanel` (fleet w/ contact-age
  + staleness, believed-fire count + `ConsoleDroneDetail` — reported status/fuel/
  retardant + a *Fires extinguished* count — + `DirectiveComposer` +
  `ConsoleFireDetail`). `DirectiveComposer`: **scan zone** (redefine the standing
  sector — needs a shift-drawn rect; a "Restore default scan zone" button clears it;
  calls `runner.setScanSector`, *not* a queued directive, so no duration/importance
  field) / extinguish (click a known fire) / rtb (pick base); importance 1–10 applies
  to the extinguish/rtb directives.
  `SeasonSummary` end card + restart.
- **God-Mode-only controls**: the `ConfigPanel` (seed, ignition fires/hour,
  dronesPerBase 1–4, deep-outage %) and the `BlackoutStrip` render only in God Mode.
  The User Console is purely observational + directive-issuing. `ControlBar`
  (clock, score, and a single **exclusive speed group** — `Paused` / ×1 / ×30 /
  ×180 / ×480 / ×960 / ×1800; picking a speed unpauses at it via
  `runner.playAtSpeed`, `Paused` halts) is shared.

## 10. Testing

- **vitest** (17 tracked files, all headless): sim season/detection/crash
  (`world`), autonomy, comms (dark fraction, 32-min cadence, 3-min retry, docked
  hard-line, gossip, belief isolation, staleness, sweep dead-reckoning incl. heading,
  extinguished-fire reporting, **operator scan-sector redefinition sync** — upload,
  comms-gated download, restore-default), merge rules, directives/queue/executors,
  land-clipped scan coverage + `headingAtDistance`,
  scan sectors, scan-zone overlay (**`scanRect` overrides the fixed sector**),
  kinematics, config burn, geo round-trip, ignition, rng, simRunner.
  One of those files is the seeded full-season behavior harness
  `src/sim/e2e_behavior.test.ts` (belief lag, MISSING-requires-deep-outage
  regression, determinism, crash freeze, forced RTB, gossip range).
- **Playwright** (`e2e/smoke.spec.ts`): builds + previews on `:4173` (chromium
  swiftshader), loads the app, **dismisses the default-open About dialog** (which
  would otherwise block tab/speed clicks), asserts the map canvas + 8 `.fleet-row`,
  sets ×1800,
  polls `window.__SIM__.frameCount ≥ 1000`, confirms tick/frame/drone advance and
  toggles, and asserts **zero console/page errors**. (Fast-forward is ×1800 so the
  1000-frame bar is hit before the season ends on slow software WebGL.)

## 11. Build & scripts

`npm run dev | build (tsc --noEmit && vite build) | preview | typecheck |
test (vitest run) | test:e2e`. Two **dev-only** asset scripts whose outputs are
committed and never run at app runtime: `build:basemap` (Natural Earth → clipped
GeoJSON) and `build:hillshade` (DEM tiles → `geo/hillshade.webp`).

## 12. Conventions & gotchas for future work

- **`src/sim/` stays pure** — no React/DOM/rAF anywhere except `simRunner.ts`.
  Keep the tick pipeline deterministic and headless.
- **Determinism is sacred**: only `rng.ts` (mulberry32) for randomness — no
  `Date.now()` / `Math.random()` in the sim. Comms draws from a separate forked
  stream so blackout tuning never shifts ignition. `main.tsx` runs the runner
  outside React and disables StrictMode (imperative GL ownership).
- **Belief isolation**: never let UI/belief code read `GroundTruth`. New
  console-visible facts must arrive via a sync upload or operator input.
- **All tunables live in `config.ts`.** Add new knobs there; the God-Mode
  `ConfigPanel` can expose them.
- **Git workflow**: one feature per branch off `main` → PR → **squash-merge**
  (commit subjects end with `(#N)`). `plans/implementation_plan.md` is rewritten
  per feature; this `DESIGN.md` is the stable reference — update it when the
  architecture changes.
- **Drift from old plans to remember**: detection is **10 km** (not 50), fuel is
  **2000 L / 2.8 L·min⁻¹**, scan sectors **default fixed per-drone but are now
  operator-redefinable** (`DroneTruth.patrolRect`, comms-gated — §6.5; the old "scan
  sectors are fixed, not operator-drawn" framing is superseded), the boot seed is
  **randomized per page load** (`BASE_CONFIG.seed 1337` is only the test default —
  §5.2), sync retry is a **constant 3 min** (not halving), MISSING is **76 min**. Console marker
  brightness is now **one ramp**: `staleValue = 1 − stalenessFrac` off the sim's
  single `stalenessFrac = min(age/76, 1)` — so marks blacken exactly at MISSING
  (76 min), *not* the old fixed **/100** scale (`staleValue` no longer takes an
  age or has its own denominator).
