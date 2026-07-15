# Persistent operator scan-sector redefinition (+ restore default)

## Goal

Let the operator **persistently redefine** a drone's standing scan sector by
shift-dragging a rectangle, and add a **"Restore default scan zone"** button that
reverts to the drone's built-in `scanSectorFor(id)` sector. Fixes the reported
bug where shift-drag "doesn't update the area": today the scan-zone overlay is
hard-wired to `scanSectorFor(id)` (`scanZones.ts:41`) and an operator scan is a
temporary bounded diversion that never changes the standing sector.

## Invariants to respect

- **Belief isolation**: the console mutates only via the sync path + operator
  input. So an operator sector change is operator input that is *downloaded* to
  the drone at its next sync; the console only *believes* the new sector once the
  drone reports it back (normal belief lag — on theme).
- **Determinism**: sector changes are operator-driven, no RNG. `src/sim/` stays
  pure.
- The console's blackout dead-reckoning reconstructs the sweep from the sector,
  so it must use the drone's *reported* sector, not always `scanSectorFor(id)`.

## Design — the drone's sector becomes state, synced like other telemetry

### Truth (`src/sim/`)
1. **`DroneTruth.patrolRect: RectM`** (`drones/drone.ts`) — the drone's current
   standing sector. Init to `scanSectorFor(id) ?? homeSectorRect(home, patrolBoxKm)`
   (the value already used to build `autoPatrol`). `autoPatrol` is built from it.
2. **Operator override channel** (`belief/consoleBelief.ts` + `comms/sync.ts`):
   - `ConsoleDroneRecord.pendingSector: { rect: RectM | null; issuedAt; downloadedAt } | null`
     (rect `null` = restore default). `addPendingSector(cb, id, rect, issuedAt)`
     sets it (latest wins).
   - In `download()` (sync.ts), if `pendingSector` is not yet downloaded: set
     `d.patrolRect = rect ?? defaultSectorFor(d)`, **rebuild `d.autoPatrol`** from
     the new rect, and stamp `downloadedAt`. (Comms-gated: applies only on a
     successful sync.)
3. **Telemetry** (`ReportedState` + `uploadTelemetry`): add `patrolRect: RectM`
   so the console learns the drone's current sector each sync.

### Views (`snapshot.ts`)
4. `DroneView.scanRect: RectM` = `d.patrolRect` (God Mode).
5. `ConsoleDroneView.scanRect: RectM | null` = `rep.patrolRect` (null if never
   contacted → overlay falls back to the default).
6. **Dead-reckoning** (snapshot.ts:220): reconstruct the sweep from
   `rep.patrolRect ?? scanSectorFor(rec.id)` instead of always `scanSectorFor`.

### Overlay (`ui/map/scanZones.ts`)
7. `ScanDrone.scanRect?: RectM | null`; `zoneFor` uses `d.scanRect ?? scanSectorFor(d.id)`.
   Both view arrays already flow into `scanZoneLayers` (MapCanvas 82/97) and now
   carry `scanRect`, so no call-site change. God Mode shows the live sector;
   the console shows the last-reported one.

### UI (`ui/`)
8. Runner API: `setScanSector(droneId, rect: RectM | null)` → `addPendingSector`.
9. **`DirectiveComposer`**: the "scan" action becomes **"set scan zone"** — the
   shift-drag `draftRect` redefines the sector via `runner.setScanSector(target,
   draftToRectM(draftRect))` (persistent; no `durationMin`). Add a **"Restore
   default scan zone"** button → `runner.setScanSector(target, null)`. Copy/hint
   updated ("Shift-drag to set this drone's scan zone").

## Decision to confirm

**The composer's "scan" today issues a *bounded* scan (sweep an area for N
minutes, then revert).** Making shift-drag a persistent sector redefinition means
that bounded-scan action goes away from the UI (the `ScanDirective` type +
executor stay, since `autoPatrol` is a `ScanExec`). Options:

- **(A, recommended)** Repurpose "scan" → persistent "set scan zone". Matches the
  user's mental model (shift-drag = the drone's scan area) and the bug report.
  Drops the bounded-scan UI.
- **(B)** Keep bounded "scan" and add a *separate* "Set scan zone" + restore
  control. Preserves both, but two rect-drawing flows share one `draftRect`
  (more UI, more confusing).

## Tests
- **sync/directive**: operator sets a sector → drone downloads at next sync →
  `d.patrolRect` updated and `autoPatrol` rebuilt to the new rect; blacked-out
  drone doesn't apply until it reconnects; reset (`null`) restores the default.
- **snapshot**: `ConsoleDroneView.scanRect`/`DroneView.scanRect` reflect the
  sector; dead-reckoning uses the reported sector (add/adjust a comms test).
- **scanZones** (`scanZones.test.ts`): `zoneFor` honors `scanRect` when present.
- Full `build && test && test:e2e`, then eyeball: shift-drag a new zone → overlay
  moves after sync; restore → reverts.

## Verification
`npm run build && npm test && npm run test:e2e`; dev-server eyeball; restart dev
server last.
