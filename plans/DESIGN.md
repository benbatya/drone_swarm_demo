# Fire Season Drone Swarm — System Design

> Durable design reference for the codebase, meant to onboard a future session
> quickly. It describes the system **as built** (branch `main`). Values here are
> the real defaults in `src/sim/config.ts`; when in doubt, that file wins.
>
> Note on the other docs: `plans/implementation_plan.md` is a **per-feature
> working plan** (it gets overwritten per PR — currently the basemap feature), and
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
| `seed` | 1337 | |

Time: `TICKS_PER_DAY=1440`, `TICKS_PER_SEASON=43_200` (≈24 min wall-clock at ×1
and 30 fps). Speed multipliers `[1, 30, 180, 480, 960, 1800]`;
`MAX_TICKS_PER_FRAME=600`. Bases: Redding, Chico, Weed, Sacramento.

## 6. Drones, directives, autonomy

### 6.1 `DroneTruth` (`drones/drone.ts`)

`id, homeBaseId, homePos, pos, heading, fuelL, retardant,
status: 'airborne'|'docked'|'crashed', crashedAt?, dockRemainingMin,
belief, comms, queue: Directive[], exec, execDirId, scanProgress (resume state),
override: RtbExec|null, forcedRtb, autoPatrol: ScanExec, autoExec,
scanOrientation: 'horizontal'|'vertical', scanFrac, abortedIds[]`.

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
  → extinguish fire, `score.doused++`, `retardant−1`, mark own belief out. If the
  fire is already gone on arrival → complete without dropping.
- **RTB** `stepRtb`: transit → dock (`status='docked'`, `dockRemainingMin=60`) →
  countdown → refuel/rearm to full → airborne, done.

### 6.4 Autonomy & fuel policy

- **Idle behavior** (no override, empty queue): if `retardant > 0` and a known
  active fire is within **168 km** → self-assign an extinguish on the nearest
  (`autoExec`); else fly **autoPatrol** over the drone's fixed sector. Re-evaluated
  each tick — drops the target if a peer douses it (belief flips out).
- **`applyFuelPolicy`**: forced RTB when `retardant ≤ 0`, or `fuelL < 120`, or
  remaining range `≤ distToNearestBase×1.25 + 25 km`. Installs an `override` RtbExec
  to the nearest base and aborts the current queued directive. A drone stranded
  beyond its range still **crashes** at fuel 0.

### 6.5 Scan sectors — **fixed, not operator-drawn** (`drones/scanSectors.ts`)

`scanSectorFor(id)` derives a **static rectangle per drone** from the base layout:
latitude band = halfway to the neighboring bases (or bbox border); longitude split
by index — **`-1` = west half, `-2` = east half** of the base's column. Both the sim
and the (belief-isolated) console compute this from the id alone, which is what lets
the console reconstruct a scanning drone's lawnmower during a blackout. Operators
draw only *bounded* scan directives (shift-drag rect); the standing patrol is the
fixed sector. `patrolBoxKm` is only a fallback for exotic fleet configs.

Lawnmower (`scanExec.ts`): `sweepSpacingM = 2×detectionRadiusM = 20 km`;
`buildLawnmower` is boustrophedon, entering from the nearest end. Path helpers:
`pathLength`, `pointAtDistance(s)`, `nearestArcLength(p)`, and
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
  status, forcedRtb, currentDirectiveKind, queueLen, scanning, scanOrientation`) +
  fire delta (`updatedAt > lastSyncAt`), reconcile/prune pendings, download new
  operator directives, then `nextSyncAt = now + 32`.
- **Gossip** (`gossip.ts`): every airborne pair within `gossipRangeM` (50 km)
  exchanges fire beliefs both ways; blackout-independent (the intra-swarm mesh).
- **Merge** (`merge.ts` `mergeFire`): dedupe by `cellId`; `believedOut` is monotonic
  (out-wins); else newest `updatedAt` wins; `firstSeenAt` = min. Idempotent +
  commutative (tested).
- **`KnownFire`** `{cellId, firstSeenAt, source:'self'|'gossip'|'console',
  believedOut, updatedAt}`. **`ConsoleDroneRecord`** `{id, lastContactAt,
  reported | null, pending[]}`.

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
  `= speed×age×0.3`. If the drone was **scanning**, reconstruct its fixed-sector
  lawnmower, anchor at the nearest arc-length to the last fix, and step `dist`
  forward (wrapping) — and set the **ghost heading from the sweep tangent**
  (`headingAtDistance`) rather than freezing the last reported heading. Otherwise
  project straight along the reported heading.

## 8. Snapshots & runner

- **`snapshot.ts`**: `buildSnapshot` → `TruthSnapshot` (God Mode: full drone/fire
  truth, score, `mode` per drone, plus an embedded `ConsoleView`). `buildConsoleView`
  → belief view (ghosts, staleness, pending/downloaded counts).
- **`simRunner.ts SimRunner`**: owns the world and the single rAF loop. Per frame:
  accumulate `dt×speed/60` ticks (capped 600), run `tickWorld` that many times,
  `frameCount++`, rebuild snapshots, push to the **per-frame map channel**
  (imperative `deck.gl` — bypasses React) and a **throttled ~4 Hz store channel**
  (`useSyncExternalStore`, for panels). At season end it pauses. Exposes
  `window.__SIM__ = {frameCount, tickCount, running, drone0, activeFires}` for the
  Playwright smoke. `stepTicks(n)` runs headless; `reconfigure/restart` rebuild the
  world; `issueDirective` = `addPending`; `getBlackout(id)` feeds the God timeline.

## 9. UI (`src/ui/`)

- **App / tabs**: `User Console` (`source='console'`) and `God Mode`
  (`source='truth'`), both render one `SimulationView`. `store.ts` (zustand):
  `activeTab` (default console), `selection`, `draftRect`, `showHillshade` (on),
  `showAllScans` (on).
- **Map** (`MapCanvas.tsx`): MapLibre `Map` + deck.gl `MapboxOverlay(interleaved)`.
  `FLAT_STYLE` = single ocean-blue background (offline, no tiles). Center =
  world center, zoom 5.4. **Shift-drag on the console tab draws a scan `draftRect`.**
- **Layers**: `basemap.ts` (bundled Natural Earth land/urban/lakes/rivers/states/
  places + optional `hillshade.webp` BitmapLayer) · `graticule.ts` (LOD grid:
  50 km/10 km/1 km/100 m/10 m by zoom, ≤600 lines) · `layers.ts` (God: base dots,
  fire dots, drone dots + detection circles + heading ticks + id labels) ·
  `consoleLayers.ts` (belief: last-confirmed hollow ring, ghost dot, reported→ghost
  dead-reckon line, sweep-extrapolated heading tick, growing uncertainty circle,
  color darkened by staleness) · `scanZones.ts` (fixed sector polygons + lawnmower
  hatches). `colors.ts`: `staleValue(stalenessFrac)=1−stalenessFrac` (the inverse
  of the sim's `stalenessFrac` — see §7).
- **Panels**: `GodPanel` (ConfigPanel + full fleet list + `DronePanelTruth` w/
  `BlackoutStrip` comms timeline + `FirePanel`). `ConsolePanel` (fleet w/ contact-age
  + staleness, believed-fire count + `ConsoleDroneDetail` + `DirectiveComposer` +
  `ConsoleFireDetail`). `DirectiveComposer`: scan (needs a drawn rect + durationMin,
  default 240) / extinguish (click a known fire) / rtb (pick base), importance 1–10.
  `SeasonSummary` end card + restart.
- **God-Mode-only controls**: the `ConfigPanel` (seed, ignition fires/hour,
  dronesPerBase 1–4, deep-outage %) and the `BlackoutStrip` render only in God Mode.
  The User Console is purely observational + directive-issuing. `ControlBar`
  (play/pause, speed, clock, score) is shared.

## 10. Testing

- **vitest** (17 tracked files, all headless): sim season/detection/crash
  (`world`), autonomy, comms (dark fraction, 32-min cadence, 3-min retry, docked
  hard-line, gossip, belief isolation, staleness, sweep dead-reckoning incl. heading),
  merge rules, directives/queue/executors, scan coverage + `headingAtDistance`,
  scan sectors, kinematics, config burn, geo round-trip, ignition, rng, simRunner.
  One of those files is the seeded full-season behavior harness
  `src/sim/e2e_behavior.test.ts` (belief lag, MISSING-requires-deep-outage
  regression, determinism, crash freeze, forced RTB, gossip range).
- **Playwright** (`e2e/smoke.spec.ts`): builds + previews on `:4173` (chromium
  swiftshader), loads the app, asserts the map canvas + 8 `.fleet-row`, sets ×1800,
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
  **2000 L / 2.8 L·min⁻¹**, scan sectors are **fixed per-drone**, sync retry is a
  **constant 3 min** (not halving), MISSING is **76 min**. Console marker
  brightness is now **one ramp**: `staleValue = 1 − stalenessFrac` off the sim's
  single `stalenessFrac = min(age/76, 1)` — so marks blacken exactly at MISSING
  (76 min), *not* the old fixed **/100** scale (`staleValue` no longer takes an
  age or has its own denominator).
