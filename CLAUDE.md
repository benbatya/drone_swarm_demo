# CLAUDE.md

Guidance for working in this repo. Fire Season Drone Swarm Demo — a Vite +
React + TypeScript SPA simulating a NorCal wildfire season.

## Build & test commands

Run from the repo root (`npm install` first if `node_modules/` is missing).

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` (append `-- --host` to expose on the LAN) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Build (typecheck + bundle) | `npm run build` |
| Preview a build | `npm run preview` (port 4173) |
| Unit tests (once) | `npm test` (`vitest run`) |
| Unit tests (watch) | `npm run test:watch` |
| End-to-end smoke test | `npm run test:e2e` (Playwright) |

Before considering a change done, run: `npm run build && npm test && npm run test:e2e`,
then **restart the dev server as the final step** so it serves the current code
(`npm run dev`). The Playwright smoke test asserts **zero console errors** while
the sim runs, so keep the app offline/keyless — no external tile/style/network
fetches at runtime.

## After a PR is merged

Once a PR lands on `main`, clean up:

- **Shut down the dev server** if it's still running (it's now serving pre-merge
  code and there's nothing more to eyeball for that change).
- **Delete the local feature branch** (`git branch -d <branch>`; the remote
  branch is deleted by the squash-merge). Switch to `main` and fast-forward it
  first (`git checkout main && git pull --ff-only`).

## Data generation (dev-time only, not shipped)

These regenerate committed assets from Natural Earth / DEM sources and require
network access. Only run them when the underlying data must change:

| Task | Command | Output |
| --- | --- | --- |
| Basemap vectors | `npm run build:basemap` | `src/ui/map/geo/*.json`, `src/sim/land.json` |
| Hillshade raster | `npm run build:hillshade` | `src/ui/map/geo/hillshade.webp` |
