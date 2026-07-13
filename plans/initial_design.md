# Swarm C2 Console — Design & Build Plan

> Working document for a distributed, multi-user, intent-based command console for a
> drone swarm (Legion-style Core C2). Structured for local iteration — edit freely,
> check off decisions, and fill in the open questions as you learn the real constraints.

**Status:** draft / thinking doc
**Last updated:** _fill in_

---

## 0. Framing

A swarm C2 console is **multiplayer game netcode married to robotics safety**:
client-side prediction + authoritative reconciliation (games) plus fail-safe autonomy
and human-in-the-loop conflict resolution (robotics).

Three distinct problems wearing one skin:
1. **Dense geospatial telemetry rendering** under tight latency.
2. **Distributed, collaborative, comms-tolerant state** across operators + assets.
3. **Intent-based command** with a hard safety envelope.

Guiding principles:
- The **console is a lens, never in the safety/time-critical control loop.**
- Operators issue **intent** (goals + constraints), not micro-commands.
- **Assume partition is the normal case** — intermittent, low-bandwidth, possibly jammed.
- **Never render stale data as if it's live.**

---

## 1. State model — tier by authority

Don't treat "state" as one thing. Tier it by who owns the truth; that dictates the
consistency and conflict rules.

| Tier | Source of truth | Consistency | Conflict resolution |
|---|---|---|---|
| **Perception / status** (tracks, health, sensor, fuel) | Aircraft / edge; console is a cache | Freshest wins; optimize for freshness | Last-writer-wins by source clock |
| **Intent / tasking** (missions, orbits, targets, ROE, geofences) | Operator / C2; aircraft keeps executing | Single-writer leases; idempotent | Surface to a human — never silent auto-merge |
| **Local / derived UI** (selections, camera, filters, layout) | Console-local, or shared between operators | CRDT / OT for collaboration | Auto-converge |
| **Safety envelope** (see §3) | Configured by C2, enforced on-board | Always-on at edge | **Most-restrictive wins / fail-safe** |

Structural choices:
- [ ] **Event-sourced core** — append-only log, materialize views by folding. Gives
      replay-after-reconnect, causal merge, and a full audit trail. Add periodic snapshots.
- [ ] **Logical clocks** (Lamport / vector) + per-node monotonic sequence numbers.
      Not wall-clock — time sync is unreliable over a contested link.
- [ ] **Authoritative autonomous edge** — swarm keeps operating correctly if the console vanishes.

---

## 2. Degraded-comms reconciliation

Reconnect is one **bidirectional exchange** with **symmetric mechanism, asymmetric policy.**

### Reconnect flow (per node, on link return)
1. **Comms drop / partition** → operate local-first, queue intent-events.
2. **Link returns** → detect reconnect, pick a peer.
3. **Merkle diff** → exchange root hashes, descend only mismatched subtrees, find deltas.
4. **Prioritized delta sync** → `safety > tracks > telemetry > history`; for high-rate
   streams sync the *latest value*, drop the stale backlog.
5. **Reconcile per tier** → perception: newest wins · intent: human-resolved · envelope: most-restrictive.

### Console vs aircraft asymmetry
- **Perception flows up** (aircraft authoritative) — console accepts, never overwrites.
- **Intent flows down** (console authoritative) — aircraft applies idempotently + acks.
- **Envelope reconciles both ways**, most-restrictively — the only shared safety concept.
- A **stale console** is a display problem (dead-reckon + staleness cues). A **stale aircraft**
  is a safety problem (hold last valid intent, run lost-link contingency inside its envelope).

### Mechanisms to implement
- [ ] Local-first optimistic writes; reconcile on reconnect.
- [ ] Delta sync via **version vectors / Merkle trees** (not full resync).
- [ ] **Gossip + anti-entropy** between ground nodes so state heals across the mesh,
      not via a single server/link. (Gossip spreads fast + coordinator-free; anti-entropy,
      backed by Merkle diffs, guarantees eventual convergence and cheaply repairs partitions.)
- [ ] Bandwidth-aware prioritization by QoS class.
- [ ] Visible staleness: last-heard age, confidence, dead-reckoning with growing error ellipse.
- [ ] Command semantics: idempotent command IDs, intent-over-imperative, leases,
      `pending → ack/nack` reconciliation, conflict surfacing for intent.
- [ ] Two networks: intra-swarm mesh (local, reliable) vs contested swarm↔C2 link;
      swarm elects a relay/aggregator that summarizes upward.

---

## 3. The safety envelope — what it enforces

The hard constraints that bound what an asset is *allowed* to do, **enforced locally by the
aircraft** regardless of what any operator or the autonomy commands. Intent = what to do;
envelope = what it's never allowed to do.

- **Spatial:** geofences (keep-in / keep-out), altitude floor/ceiling, standoff distances.
- **Kinematic / platform:** max speed, bank/turn/climb limits, min fuel/energy reserve (bingo/joker → forced RTB).
- **Engagement / ROE:** weapons permitted at all, hold vs free, target-class + geographic limits,
      **positive human authorization required for lethal action** (enforced, not hoped).
- **Behavioral / autonomy:** autonomy latitude, unlocked modes, neighbor deconfliction, collision minimums.
- **Lost-link contingency:** loiter / RTB / continue-bounded-then-RTB / terminate. Pre-negotiated *while connected*.

Two defining properties:
- **Enforced at the edge, always-on** — console configures, aircraft enforces every cycle, through blackout.
- **Inverted reconciliation** — on ambiguity, apply the *most restrictive* bound and fail safe.
      A dropped/stale message can only make the asset **more** cautious, never less.

---

## 4. Recommended tech stack

Opinionated defaults first, alternatives in parens. **Anchor final choices to what Swarm
already runs** — inherit their ROS 2 / DDS / Cesium / sync decisions rather than reinventing.

### Map / tactical picture (dense telemetry over geography)
- **Default:** `deck.gl` (WebGL2, GPU-instanced) over a `MapLibre GL` basemap.
      Layered model fits telemetry classes (tracks / paths / geofences / coverage heatmap).
      MapLibre over Mapbox = open-source, no phone-home (matters for air-gapped/defense).
- **If altitude/3D is central:** `CesiumJS` (± `resium`) — aerospace-standard 3D-geo; can host deck.gl layers.
- **Custom 2D canvas beyond deck.gl:** `regl` / `PixiJS` / raw WebGPU (probably premature).
- [ ] **Decision:** 2D-fast (MapLibre+deck.gl) vs 3D-accurate (Cesium)? → depends on altitude story.

### Time-series / status telemetry
- **uPlot** for large real-time series (canvas, very fast). `visx` / Observable Plot for analytical.
- Know by name: **Foxglove** + **MCAP** log format = robotics-standard telemetry/replay. Good for debug/audit.

### App framework + state
- **React + TypeScript** (their named stack). Keep the hot render loop **out of React's reconciler** —
      deck.gl/canvas run their own immediate-mode loop off a ring-buffer of latest state.
- **Edge-authoritative state (perception/intent):** local-first sync engine —
      `ElectricSQL` / `Zero` (Rocicorp) / `PowerSync` / `Replicache`, or build on `TanStack Query`
      optimistic mutations + own event log.
- **Collaborative multi-operator state:** CRDT — `Yjs` (fastest for real-time collab) or
      `Automerge` (cleaner doc model + history).
- **Command/intent lifecycle:** `XState` statecharts for `pending → acked → executing → done/failed/superseded`
      and safety modes (weapons-hold/free, autonomy level, degraded-link banner) — invalid transitions unrepresentable.
- **Local UI state:** `Zustand` (or Redux Toolkit).

### Transport + comms
- **Wire format:** Protocol Buffers (schema-evolving, compact). FlatBuffers/Cap'n Proto for zero-copy; Avro also viable.
- **Browser transport:** **WebTransport** (HTTP/3 / QUIC) — supports *unreliable datagrams*,
      so drop stale telemetry instead of head-of-line-blocking a lossy link. **WebSocket** fallback.
      `Connect / gRPC-Web` for request/response + server streaming with clean protobuf types.
- **Edge/robotics bus:** **DDS/RTPS** (ROS 2, rich QoS) and/or **Zenoh** (built for lossy, low-bandwidth,
      intermittent mesh). **MAVLink** at the vehicle. Gateway bridges DDS/Zenoh/MAVLink → protobuf-over-WebTransport.

### Backend services
- **Language:** Rust (perf/safety, defense-trending) — or Go (simpler concurrency) or C++ (existing strength).
- **Log/bus:** NATS JetStream / Redis Streams. **History:** TimescaleDB / ClickHouse.
- Intent = append-only, idempotent, schema-validated command log.
      **Envelope validated at issue** (protobuf validators / JSON Schema / CUE) so out-of-envelope intent can't be emitted.

### How the stack maps to the tiers
- Perception → datagram/WebTransport, drop-stale, render via deck.gl.
- Intent → reliable acked idempotent protobuf commands, XState lifecycle.
- Collaboration + local UI → CRDT.
- Whole thing local-first → partition degrades to cached + dead-reckoned, not a blank screen.

---

## 5. Suggested build phases

- [ ] **P0 — Skeleton:** React+TS shell, MapLibre+deck.gl map, mock telemetry generator,
      render N moving tracks at target frame rate. Prove the immediate/retained split.
- [ ] **P1 — State + transport:** protobuf schemas, WebTransport (WS fallback) ingest,
      ring-buffer → render loop, staleness/dead-reckoning indicators.
- [ ] **P2 — Intent path:** command schema + XState lifecycle, optimistic pending→ack,
      envelope validation at issue, idempotent IDs.
- [ ] **P3 — Comms tolerance:** local-first cache, event log + snapshots, Merkle/version-vector
      diff, reconnect flow, prioritized delta sync.
- [ ] **P4 — Collaboration:** CRDT for shared selections/annotations/planning; multi-operator
      leases + conflict surfacing for intent.
- [ ] **P5 — Mesh + replay:** gossip/anti-entropy across ground nodes, MCAP replay/audit.

---

## 6. Open questions / decisions to resolve

- [ ] Real **link budget** — loss / latency / bandwidth profile of the swarm↔C2 link?
- [ ] Is there a reliable **intra-swarm mesh**? Does the swarm elect a relay/aggregator?
- [ ] How much **autonomy already lives on the asset** (onboard planner)? What do I inherit vs build?
- [ ] Existing **deconfliction + lost-link** behaviors?
- [ ] **Safety / regulatory / ROE** constraints, and human-in-the-loop requirements for lethal action?
- [ ] Existing stack: **ROS 2 / DDS? Zenoh? Cesium? a chosen sync engine?** → adopt, don't reinvent.
- [ ] Scale target: how many assets per operator? "Superhuman operator" fan-out?
- [ ] Security posture: air-gapped? classified network? affects basemap/tile hosting + telemetry.

---

## 7. Interview soundbites (keep handy)

- "A swarm C2 console is multiplayer game netcode married to robotics safety."
- "Symmetric mechanism, asymmetric policy — perception flows up, intent flows down,
  the envelope reconciles most-restrictively both ways."
- "Never render stale state as if it's live."
- "Intent tells an asset what to do; the envelope defines what it's never allowed to do,
  is enforced on-board with no comms, and always resolves toward the safer bound."
- "Gossip spreads state fast and coordinator-free; anti-entropy, backed by Merkle diffs,
  guarantees the replicas eventually agree and cheaply repairs what a partition dropped."
- "I'd anchor the stack to what Swarm already runs — the value is knowing the tradeoffs and
  picking against their link budget, scale, and security posture."

### Personal through-lines to connect
- **Tensil.io / Generation Alpha Transistor** → real-time collaborative multi-user (+ AI-agent) state.
- **Velo3D** → validation-at-the-boundary (invalid state can't reach the printer ≈ can't emit out-of-envelope intent).
- **Vytronus** → correctness-critical real-time telemetry display where stale state has real consequences.
- **XrSim** → real-time multi-user simulation engine, native + web rendering, first engineer.
- **OSM/OpenGL demo** → dense geospatial GPU rendering under performance constraints.
