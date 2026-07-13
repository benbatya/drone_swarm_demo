# Fire Season Drone Swarm Demo — Implementation Plan

> **Execution notes:**
> Implementation is to be done with **Opus 4.8** (implementation subagents launched with `model: "opus"`).
> **Source of truth:** the canonical copy of this plan lives in the repo at `plans/implementation_plan.md`; this plan-mode scratch file mirrors it. The repo copy will be re-synced with this content as the first implementation step (it can't be edited from plan mode + the bg-isolation guard).

## Context

Greenfield browser SPA in `/home/benbatya/Documents/code/drone_swarm_demo` (repo is empty except `plans/initial_design.md`). It simulates a 30-day forest-fire-fighting season in Northern California where 8 autonomous drones detect and extinguish fires under an intent-based directive system with unreliable console↔drone comms. It concretizes the ideas in `plans/initial_design.md`: the console is a lens (never in the control loop), operators issue intent not micro-commands, and stale data is never rendered as live — made literal by two tabs, **User Console** (believed state) vs **God Mode** (ground truth).

## Requirements summary

- **World**: NorCal bbox ≈ lat 37.8–42.1, lon −124.5–−119.9 (~392×478 km). 10m×10m grid (sparse — only fires stored, never a dense array). Fires ignite at random cells (Poisson, configurable λ), never within 1000 m of a base, don't spread, persist until doused. 1 retardant drop extinguishes 1 fire. Score = total fire-minutes burned (God Mode only).
- **Time**: 1 sim-minute per frame @ 30 fps → 43,200 frames ≈ 24 min wall-clock. Pause/resume + speed multiplier controls.
- **Bases (4)**: Redding (40.59,−122.39), Chico (39.73,−121.84), Weed (41.42,−122.39), Sacramento (38.58,−121.49).
- **Drones (8, 2/base, configurable)**: speed **1680 m/sim-min** (100.8 km/h); **fire detection radius 50 km** (a drone only learns a fire exists once it flies within 50 km of it — detection is drone-mediated, not omniscient; see the detection-stage rationale); 10 retardant loads; **1000 L fuel giving a 600 km operational range** (≈168 L/h burn = 2.8 L/sim-min at cruise); always airborne unless docked; base turnaround 60 sim-min (refuel+rearm); **fuel < 120 L or zero retardant → the drone aborts its current directive** (cancelled, not suspended; abort reported to console at next sync) and force-RTBs to the nearest base; remaining queue resumes after turnaround. **Fuel exhaustion mid-air → the drone crashes**: permanently down for the season, frozen at crash position, no further comms/gossip/detection. God Mode shows status `crashed`; the console can only infer loss of contact.
- **Missing status (console-side, derived)**: if the console has had no contact with a drone for **> 64 game-minutes**, it reports the drone as **missing**, displaying its last known location and heading. Status clears on next successful sync; a crashed drone becomes permanently missing on the console.
- **Directives** (queued, importance-ordered): ① scan rectangle for a duration (lawnmower, line spacing = 100 km detection diameter), ② extinguish fire at cell, ③ RTB to specific base. Complete → remove → next. **Empty queue → autonomous idle behavior** (re-evaluated continuously): if the drone still has retardant and its belief holds an active fire within **168 km**, it self-assigns an extinguish on the nearest such fire; otherwise it flies **autoPatrol** (a standing home-sector lawnmower scan). Both run until an operator directive preempts them or a fuel/retardant condition forces RTB. Operator pushes pending directives anytime; drone downloads them at sync.
- **Comms**: drone-initiated sync every **32 sim-min** (upload discovered fires + telemetry + current directive/queue; download pendings). Per-drone alternating blackout windows, ~40–60% dark, with a heavy tail: mostly short routine blackouts plus occasional **deep outages** (>64 min) that push a still-flying drone into console-side "missing". Failed sync (dark at the attempt) → interval-halving retry (**16→8→4→2→1 min**, staying at 1 until success), reset to the 32-min cadence on success. Drone↔drone gossip (fires + current directives) when in range, unaffected by blackouts.
- **UI**: one page, two tabs sharing one view component — map with LOD grid overlay, drone/fire selection, side panel, directive composer (Console tab only), staleness cues (last-contact age, dead-reckoned ghost), blackout timelines (God Mode only).

## Architecture — two worlds, one bridge

- `src/sim/` is **pure TypeScript, zero React imports**, tick-based, fully headless-testable.
- **GroundTruth** (authoritative sim) vs **DroneBelief** (per-drone: own detections + gossip + downloads) vs **ConsoleBelief** (only successful syncs + operator input). **`comms/` is the only module that reads truth and writes belief** — enforced by module structure and a belief-isolation test.
- `simRunner.ts` is the only sim file touching `requestAnimationFrame`; everything else runs in vitest.

## Stack

Vite + React + TypeScript. Map: **MapLibre GL** (OpenFreeMap/demotiles style, no API key; flat-color fallback so it runs offline) + **deck.gl** `MapboxOverlay` layers. UI state: zustand. Tests: **vitest** (headless sim units) + **Playwright** (browser E2E smoke — boots the real SPA). Seeded PRNG (mulberry32) for determinism.

## Directory structure

```
src/
├── main.tsx                    entry; constructs SimRunner outside React
├── sim/                        pure TS core (no React)
│   ├── config.ts               SimConfig + defaults (all tunables)
│   ├── rng.ts                  seeded PRNG + poisson/uniform helpers
│   ├── geo.ts                  meters⇄lat/lon projection, cell indexing, distance
│   ├── clock.ts                tick counter / sim-min / day-of-season
│   ├── world.ts                GroundTruth container + tick() pipeline
│   ├── ignition.ts             Poisson spawner w/ 1000m base exclusion
│   ├── scoring.ts              fire-minutes accumulator
│   ├── drones/
│   │   ├── drone.ts            DroneTruth + per-tick mode arbitration
│   │   ├── kinematics.ts       move-toward, heading, fuel burn, dock timer, crash
│   │   ├── detection.ts        truth fires within 50km → drone belief
│   │   └── fuelPolicy.ts       fuel < 120 L / retardant = 0 → abort + forced RTB
│   ├── directives/
│   │   ├── types.ts            Directive union + importance ordering
│   │   ├── queue.ts            insert/sort/preempt/abort/complete
│   │   ├── executor.ts         dispatch + lifecycle (step per tick)
│   │   ├── scanExec.ts         lawnmower waypoints (100km spacing) + resume
│   │   ├── extinguishExec.ts   transit → drop → done (skip if already out)
│   │   └── rtbExec.ts          transit → dock → 60-min turnaround
│   ├── comms/
│   │   ├── blackout.ts         per-drone window gen: routine + rare deep outages (lookahead)
│   │   ├── sync.ts             console⇄drone exchange + interval-halving retry
│   │   ├── gossip.ts           pairwise in-range fire/directive exchange
│   │   └── merge.ts            dedupe by cellId; doused-wins; newest-wins meta
│   ├── belief/
│   │   ├── droneBelief.ts      known fires + peer meta + delta watermark
│   │   └── consoleBelief.ts    known drone records, fires, pending directives
│   ├── snapshot.ts             pooled TruthSnapshot/ConsoleSnapshot builders
│   └── simRunner.ts            rAF driver, pause/speed accumulator, subscribers; exposes window.__SIM__ test hook (frameCount/tickCount/running) in dev/test builds
├── ui/
│   ├── App.tsx                 tabs ("User Console" / "God Mode"), layout
│   ├── store.ts                zustand: activeTab, selection, rect-draw state
│   ├── useSimSnapshot.ts       useSyncExternalStore, throttled ~250ms for panels
│   ├── ControlBar.tsx          pause/speed ×1/×4/×16/×60, clock/day, score badge
│   ├── SimulationView.tsx      shared view; prop source: 'console' | 'truth'
│   ├── viewModel.ts            snapshot → ViewModel (source-agnostic shape)
│   ├── map/
│   │   ├── MapCanvas.tsx       MapLibre + MapboxOverlay; imperative setProps/frame
│   │   ├── layers.ts           drones, fires, bases, scan rects, ghosts, ranges
│   │   ├── graticule.ts        LOD grid lines from viewport bounds
│   │   └── ScanRectDraw.tsx    shift-drag rectangle → DirectiveComposer
│   └── panels/
│       ├── DronePanelBelief.tsx  known state, staleness, missing, pending→downloaded
│       ├── DronePanelTruth.tsx   actual state, override flag, blackout timeline
│       ├── FirePanel.tsx         truth: time alight; belief: discoveredAt/by
│       └── DirectiveComposer.tsx build scan/extinguish/rtb + importance
└── tests/                      geo, ignition, scan, fuel, comms, gossip,
                                belief-isolation, season (headless full run)
e2e/
├── playwright.config.ts        starts `vite preview` (or dev) as webServer, chromium
└── smoke.spec.ts               boots SPA, asserts sim runs ≥1000 frames, no console errors
```

## Data model (key types)

```ts
type CellId = number;                    // cy * GRID_COLS + cx (~1.9e9 max, safe int)
interface Vec2 { x: number; y: number }  // local meters, origin SW corner

interface FireTruth { cellId; ignitedAt; extinguishedAt?; extinguishedBy? }
interface GroundTruth { now; fires: Map<CellId,FireTruth>; drones: DroneTruth[];
                        bases: Base[]; score: { fireMinutes; totalFires; doused } }

interface DroneTruth {
  id; homeBase; pos: Vec2; headingRad; fuelL; retardant;
  status: 'airborne'|'docked'|'crashed'; crashedAt?; dockRemainingMin?;
  queue: Directive[];              // importance desc, then issuedAt
  exec: DirectiveExec | null;      // running state machine for queue head
  override: RtbExec | null;        // forced RTB (fuel/retardant) — above queue, not a directive
  autoPatrol: ScanExec;            // standing home-sector scan; idle fallback when no known in-range fire
  autoExec: DirectiveExec | null;  // self-assigned idle action (extinguish nearest known fire ≤168km, or autoPatrol)
  belief: DroneBelief; comms: DroneCommsState;
}

type Directive =
  | { kind:'scan';       id; importance; issuedAt; rect: RectM; durationMin }
  | { kind:'extinguish'; id; importance; issuedAt; cellId }
  | { kind:'rtb';        id; importance; issuedAt; baseId };

interface DroneCommsState { darkWindows: {startMin,endMin}[];   // lookahead ≥6h
  nextSyncAt; retryIntervalMin; lastSyncAt }

interface KnownFire { cellId; firstSeenAt; source:'self'|'gossip'|'console';
                      believedOut: boolean; updatedAt }
interface ConsoleDroneRecord {
  lastContactAt;
  reported: { pos; headingRad; fuelL; retardant; status; forcedRtb;
              currentDirective; queue } | null;
  pending: { directive: Directive; issuedAt; downloadedAt? }[];
}
```

## Coordinates & grid

- Local equirectangular meters plane, origin SW (37.8, −124.5), ref latitude 39.95: `y=(lat−37.8)·111195`, `x=(lon+124.5)·111195·cos(39.95°)`; inverse for rendering. All sim math flat 2D meters (≤~2.7% distortion, self-consistent).
- Grid: `cx=⌊x/10⌋, cy=⌊y/10⌋`, `cellId = cy*GRID_COLS + cx`. Sparse only — `Map<CellId, …>` everywhere; no dense array ever.

## Fuel model (600 km operational range)

- Full tank `fuelCapacityL = 1000` gives a **600 km operational range**. At cruise speed 1680 m/sim-min:
  - endurance = 600 km ÷ 100.8 km/h ≈ **5.95 h** ≈ 357 sim-min aloft per full tank.
  - burn rate = 1000 L ÷ 5.95 h ≈ **168 L/h = 2.8 L/sim-min** (`fuelBurnLPerMin = 2.8`).
- `config.ts` carries range as the primary knob: `operationalRangeKm = 600`, and derives `fuelBurnLPerMin = fuelCapacityL × speedMPerMin / (operationalRangeKm × 1000)` so the two stay consistent if either is retuned.

## Sim loop (tick = 1 sim-minute)

Pipeline order in `world.tick(rng)`:

- **Clock** — advance sim time by 1 minute.
- **Ignition** — sample Poisson(λ) for new fires; reject cells within 1000 m of a base or already burning.
- **Drone decisions + directive execution**
  - Fuel/retardant policy: fuel < 120 L or retardant = 0 → **abort current directive** (cancelled, reported at next sync) and install forced-RTB override to nearest base.
  - Step the active executor (scan / extinguish / rtb); retardant drops mutate truth fire + drone's own belief.
  - Completed directive → pop → activate next; empty queue → **autonomous idle decision** (re-run each tick): if `retardant > 0` and the drone's belief holds an active (not `believedOut`) fire whose distance ≤ **168 km** (`autoEngageRangeKm`), self-assign a synthetic extinguish on the **nearest** such fire; otherwise fall back to **autoPatrol** (standing home-sector scan). Both are lowest priority — any operator directive preempts them, and a forced fuel/retardant RTB overrides both. The self-extinguish re-evaluates each tick, so if its target is doused by another drone (belief flips to `believedOut` via gossip/detection) it drops it and picks the next in-range fire or returns to autoPatrol.
- **Kinematics** — move ≤1680 m toward target, update heading; burn fuel (airborne only, 2.8 L/min); dock countdown, refuel/rearm at 0 remaining.
  - **Fuel hits 0 while airborne → status `crashed`**: position frozen, exec/queue abandoned, excluded from detection/gossip/sync forever.
- **Detection** — truth fires ≤50 km from a drone → that drone's belief; a believed-active fire observed absent (within range but not burning) → `believedOut`.
  - **Design rationale — detection is drone-mediated, not god-like.** A fire that ignites is invisible to everyone until a drone physically comes within its 50 km detection radius; only then does that drone know it exists, and only at the next successful console sync does the operator learn of it. This deliberately replaces an omniscient "new fires are auto-reported to the console" mechanism. The radius is set generously large (50 km) so that once a drone is anywhere in a fire's general area the fire is obviously and reliably picked up — the challenge is *getting a drone within range* (coverage, patrol routing, gossip-sharing discoveries), not squinting for a needle. Consequence: the console's fire picture always lags ground truth by however long it takes a drone to fly within 50 km of each new ignition and then sync — the core belief-vs-truth gap the two tabs exist to show.
- **Gossip** — every pair of airborne drones **within 50 km of each other** (straight-line meters): merge fire maps both ways + exchange current-directive meta (≤28 pairs, cheap). Unaffected by console blackouts.
- **Console sync** — per drone due this tick: succeed (exchange state/directives) or schedule interval-halved retry.
- **Scoring** — `fireMinutes += activeFireCount`.

**UI handoff without re-render storms**: `SimRunner` owns a rAF loop with time accumulator (`ticksOwed += dt·30·speed`, cap ~600 ticks/frame for fast-forward), then rebuilds **pooled snapshots** (Float32Array drone buffers, reused fire arrays, version counter). deck.gl path bypasses React: `MapCanvas` calls `overlay.setProps({layers})` imperatively per frame. React panels subscribe via `useSyncExternalStore` notified at most every ~250 ms.

## Directive executors

- **Scan (lawnmower)**: waypoints = sweep lines parallel to rect's long axis, spaced 100 km (detection diameter), clamped to rect, enter nearest corner; loop pattern if finished before `durationMin`; preemption saves `elapsedMin`, resume regenerates waypoints entering at nearest point. **autoPatrol reuses this exec** with the drone's standing home-sector rect and effectively unbounded duration (loops forever, never reports complete).
- **Extinguish**: fly to cell center; within 50 m → drop (retardant−1, set `extinguishedAt`, mark own belief out). If belief already says out on approach → complete without dropping.
- **RTB**: transit → dock (status `docked`, 60-min countdown) → refuel/rearm → done. Forced-RTB override reuses this targeting nearest base; lives in `drone.override` (never in queue, reported to console as `forcedRtb` flag). Trigger: **fuel < 120 L or retardant = 0**. On trigger the current directive is **aborted** — removed from the queue, marked aborted, abort reported at next sync (console prunes it); the rest of the queue resumes after turnaround.
- **Queue**: importance desc, issuedAt asc; higher-importance download preempts running exec (progress saved).

## Comms

- **Blackouts**: per drone, seeded sub-RNG, alternating connected ~U(15,35) / dark windows. Each dark window is **routine** ~U(10,40) min with probability 0.95, or a **deep outage** ~U(80,220) min with probability 0.05 (jamming / terrain masking / fault). Blended dark mean ≈ 31 min vs connected mean 25 → **≈56% dark** (within the 40–60% target; all three params — connected bounds, routine dark bounds, deep-outage probability + bounds — live in config). Routine windows (≤40 min) never cross the 64-min missing threshold, so they only ever raise the staleness cue; deep outages (>64 min) are the events that drive a live drone into console-side **missing** and then snap back on reconnect. Single unified `darkWindows` list (routine + deep) so the God Mode timeline renders both with deep outages visually distinct. Lazy generation with ≥6 h lookahead. Docked drones treated as hard-lined (always syncable).
- **Sync (drone-initiated, atomic)**: normal cadence is **every 32 min** (`nextSyncAt = lastSuccess + 32`). At `nextSyncAt`, if dark → failure: first failure schedules a retry in **16 min**, each subsequent failure halves it (**16→8→4→2→1**, floor 1 min) until a sync succeeds. Success → upload telemetry + fire delta (entries with `updatedAt > lastSyncAt`) + completed/aborted-directive IDs (console prunes believed queue); download all un-downloaded pendings into queue (stamp `downloadedAt`); reset the retry interval and schedule the next sync at the regular **+32 min** cadence.
- **Merge rules** (shared gossip/sync): dedupe fires by cellId; `believedOut` monotonic (out-wins); otherwise newest-`updatedAt` wins; peer/drone meta newest-wins. Idempotent + commutative (tested).

## UI

- Both tabs render `SimulationView` with `source: 'console' | 'truth'`; identical layout, different data + titles.
- **Layers**: base icons; fires (truth: age→color ramp; belief: report-age fade); drones (icon rotated to heading; belief shows last-confirmed marker + dead-reckoned ghost along last heading at 1680 m/min with growing uncertainty circle, dashed stale ring when contact age > 10 min); scan rects (pending dashed / downloaded solid); graticule; God-Mode-only detection-radius circles + blackout badges.
- **Three escalating console states**: **fresh** (synced recently) → **stale** (amber, dead-reckoned ghost + growing uncertainty circle, in a routine blackout <64 min) → **MISSING** (red, frozen at last-known location + heading, no ghost beyond that point) when `now − lastContactAt > 64 min` — reached via a deep outage or a crash. Missing clears on next successful sync (deep outage ends → drone snaps back to true position); a crashed drone stays missing permanently. God Mode renders crashed drones with a distinct crash icon and status `crashed` + `crashedAt`, and shows each drone's blackout timeline with **routine vs deep-outage windows visually distinguished**.
- **Side panel**: Console tab → known state, live "last contact 23m ago" (amber >10m, red MISSING >64m), believed queue, pending list with downloaded checkmarks, DirectiveComposer (scan: shift-drag rect + duration; extinguish: click a known fire; rtb: pick base; importance 1–10). God Mode → actual state, override flag, blackout timeline strip, fire time-alight. Directive issuing exists only in Console tab.
- **Score**: God Mode shows true fire-minutes; Console shows only believed fire counts.
- **Ground-truth controls are God-Mode-only**: the **ignition-rate (λ) slider** and other sim-config knobs (seed, fleet size, blackout tuning) appear only in the God Mode tab's config panel — never in the User Console, which is purely observational + directive-issuing. Shared ControlBar (pause/speed/clock) stays on both tabs.

## Grid overlay (LOD graticule)

deck.gl LineLayer regenerated on view change (debounced ~100 ms), snapped to grid origin, viewport-bounded, cap ~600 lines: zoom <9 → 50 km; 9–12 → 10 km; 12–14.5 → 1 km; 14.5–16.5 → 100 m; ≥16.5 → true 10 m cell grid. Opacity fade near thresholds.

## Git & GitHub workflow (per milestone)

**Upstream repo**: `benbatya/drone_swarm_demo` on GitHub (created via `gh repo create`; `gh` is authenticated as `benbatya` with `repo` scope). Local integration branch is **`main`** (rename the current empty `master` → `main`, or set `--initial-branch=main`); `origin` points at the new GitHub repo. This repo setup is a **one-time M0 prerequisite** and is a write action — it happens once implementation begins (it can't run in plan mode).

Each milestone **M0–M4** ships as its own branch → PR → merge:

1. **Branch** off up-to-date `main`: `git switch -c milestone/m<N>-<slug>` (e.g. `milestone/m0-shell-map`, `m1-truth-sim`, `m2-directives`, `m3-comms`, `m4-polish`).
2. **Build** the milestone's scope (see below); keep commits scoped and conventional.
3. **Verify** before opening the PR: `npm run build`, `npm test` (vitest), and — from M0 on — `npm run test:e2e` (Playwright smoke) must pass.
4. **Commit + push**: `git push -u origin milestone/m<N>-<slug>`.
5. **PR**: `gh pr create --base main --title "M<N> — <title>" --body <milestone summary + verification results>`.
6. **Merge**: `gh pr merge --squash --delete-branch` (solo demo repo → squash-merge and delete the branch; no external review gate).
7. **Sync**: `git switch main && git pull` before starting the next milestone.

## Build milestones (each demoable)

- **M0 — Shell + map**: Vite scaffold, MapLibre + deck overlay, bases + graticule LOD, tab shell, vitest + Playwright wired (the ≥1000-frame smoke test can go green as soon as the M1 sim loop runs).
- **M1 — Truth sim visible**: geo/rng/clock/world/ignition/scoring, drones on hardcoded patrol, detection, crash-on-fuel-exhaustion, SimRunner + pooled snapshots + imperative layers, pause/speed. God Mode shows fires igniting + drones moving at ×60.
- **M2 — Directives + autonomy**: queue, 3 executors, preemption, abort + forced RTB + turnaround, autonomous idle (self-engage ≤168 km / autoPatrol), God-Mode panels. Drones run a season autonomously.
- **M3 — Comms + two worlds**: blackouts (routine + deep outages), sync + retry halving, gossip, DroneBelief/ConsoleBelief, Console tab with staleness cues + dead reckoning + missing status, DirectiveComposer + pending→downloaded, scan-rect draw. The money shot: Console vs God Mode divergence during blackouts.
- **M4 — Polish + verification**: score badge + end-of-season summary, **God-Mode-only config panel** (seed, ignition-rate λ, fleet size, blackout tuning — not exposed in the User Console), blackout timeline strip, full-season headless + determinism tests, Playwright smoke, perf pass, demo script.

## Verification

- **Per-tick invariants** (debug-only `assertInvariants`): 0 ≤ fuel ≤ 1000; 0 ≤ retardant ≤ 10; docked ⇒ at base pos; crashed ⇒ position/fuel frozen and never changes again; no fire within 1000 m of base; no belief fire that never existed in truth; score monotonic.
- **Unit tests**: geo round-trip (<10 m error); fuel-range consistency (full tank flown in a straight line covers ~600 km before hitting 0); lawnmower coverage (every rect cell within 50 km of path); autonomous idle behavior (queue empty + known fire ≤168 km + retardant>0 → self-extinguishes nearest; no in-range known fire or retardant=0 → autoPatrol; operator directive preempts; target doused by a peer → drops it and re-picks); fuel policy (fuel dropping below 120 L mid-directive → current directive aborted + forced RTB to nearest base → arrives if within reserve, else crashes; forcing fuel to 0 mid-air → crash, then no comms/movement ever after); blackout generator (long seeded run: dark fraction lands in 40–60%; routine windows ≤40 min never trigger missing; deep outages appear at ~5% of windows and exceed 64 min); console missing-status derivation (routine blackout → stale not missing; deep outage >64 min → missing then clears on reconnect; crashed drone stays missing); sync cadence 32 min + retry sequence 16/8/4/2/1 + reset-to-32-on-success; merge idempotence/commutativity/out-wins; belief isolation (ConsoleBelief mutates only via sync + operator input).
- **Headless season test**: seeded 43,200-tick run in node (seconds), no NaN, invariants on sampled ticks, same seed → identical final score; with blackouts off + low λ → most fires doused and console belief converges to truth by season end.
- **Playwright browser E2E (required smoke test — `npm run test:e2e`)**: Playwright starts the built app (`vite preview` as the config `webServer`), opens it in chromium, and verifies the simulation actually boots and runs:
  - the map/canvas mounts and the God Mode tab renders without throwing;
  - the sim auto-starts (or the test clicks play and sets a high speed to finish fast); the test reads the `window.__SIM__` hook the SimRunner exposes in dev/test builds and **polls until `frameCount ≥ 1000`** within a generous timeout (e.g. 60 s), asserting the counter is monotonically increasing (loop is live, not frozen);
  - `tickCount` advanced and at least one drone's rendered position changed between two samples (sim state is really progressing, not just the rAF ticking);
  - **zero uncaught page errors / console errors** captured over the run.
  - Runs in CI headless; gates "the SPA works end-to-end," complementing the headless vitest units that gate sim correctness.
- **Manual demo**: `npm run dev` → pause → ×16 → watch ignition in God Mode → switch to Console (fire unknown) → draw scan rect → pending→downloaded → drone discovers → console learns at next sync → issue extinguish → watch blackout make the ghost drift from truth → forced RTB → season score card.

## Defaults chosen for unspecified details (all in `config.ts`, easy to change)

1. **Season start / empty queue → autonomous idle** (replaces the earlier RTB-and-hold default): whenever a drone's queue is empty and no forced RTB is active, it re-evaluates each tick:
   - **Self-engage a fire** if it has retardant and knows of an active fire within **168 km** (`autoEngageRangeKm`) → self-assign an extinguish on the nearest such known fire.
   - Otherwise **autoPatrol** — a lowest-priority lawnmower scan over a box (`patrolBoxKm`, default ~200 km) centered on its home base, clamped to the bbox, looping indefinitely.
   This is also the season-start behavior (drones launch straight into autoPatrol until they discover fires), satisfying "default directive is to scan for fires." Any operator directive preempts the autonomous action; a forced fuel/retardant RTB overrides it. This deliberately overrides the original "no more directives → return to nearest base" literal — drones stay airborne and productive (hunting or patrolling) rather than idling at a base, docking only for a forced fuel/retardant RTB.
2. **Ignition rate**: λ = 1 fire/60 sim-min (~720 fires/season), slider-adjustable **only from the God Mode tab** — it's a ground-truth simulation parameter, so the User Console has no control over it (the console can only observe the consequences). The control lives in the God Mode config panel, not in the shared ControlBar.
3. **Gossip range**: **50 km** — two drones exchange state when within 50 km of each other (matches detection radius). Configurable but this is the fixed default.
4. **Drop mechanics**: instantaneous when within 50 m of cell center.
5. **Low-fuel floor**: fixed — forced RTB when fuel < 120 L. With the **600 km operational range** this is a **~72 km reserve** (120 L of 1000 L), so fuel is a real constraint while giving a comfortable margin to reach a base. Crashes remain reachable: a drone that crosses 120 L while >~72 km from every base still can't get home and will crash. Alternative if retuning is wanted later: a distance-aware trigger (RTB when remaining range ≤ dist-to-nearest-base × 1.25 + margin).
6. **Importance**: integers 1–10 (default 5); forced RTB is an override channel outside the queue so it can't be out-prioritized.
7. **Land cover**: fires may ignite anywhere in bbox (no ocean/urban masking — acceptable for demo, noted for later).

## Open follow-up (flagged, not yet decided)

- **Amber staleness threshold vs 32-min sync cadence**: the amber "stale" cue is currently >10 min contact age, but with a 32-min base sync cadence a healthy drone routinely hits ~32 min even without blackout, so >10 min would be lit almost constantly. Consider bumping amber to ~>40 min (just past one normal cadence) while keeping MISSING at 64 min. Left at 10 min pending a decision.
