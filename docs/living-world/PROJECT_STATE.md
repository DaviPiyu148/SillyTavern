# LWS Project State

## As-of

2026-09-23.

## Host repository

`DaviPiyu148/SillyTavern`, target branch `release`.

## Repository observations

The inspected host contains the standard SillyTavern structure: `src/`, `src/endpoints/`, `public/`, `public/scripts/`, `plugins/`, `data/`, and `tests/`.

As of Phase 3 completion, the native LWS subsystem namespace, authored domain models, and simulation runtime persistence are established and integrated:
- `src/living-world/` (errors, db, migrations, authored domain services, simulations runtime services, index)
- `src/living-world/authored/` (worlds, characters, locations, factions, scenarios, world-rules, prompt-configs, common)
- `src/living-world/simulations/` (simulations, simulation-characters, common)
- `src/endpoints/living-world.js` (status, ping, authored REST endpoints, and simulation runtime REST endpoints)
- `public/scripts/living-world/`
- `data/living-world/`
- `tests/living-world/` (comprehensive suites covering DB, migrations, authored services, simulations runtime, two-simulation isolation, cross-world integrity triggers, immutability, and REST endpoints)

## Designed and accepted

The supplied ADR set establishes:
- modular-monolith/local-first principles;
- SQLite v0.1 persistence;
- LLM state-authority boundary;
- event-driven/on-demand simulation;
- generic model integration principle;
- authored/runtime separation;
- causal persistent character development;
- first-class user system prompts within application-enforced boundaries;
- provenance-preserving normalization;
- deterministic agendas/schedules/event ordering/replay.

## Current implementation decisions

LWS is implemented as a native subsystem of the SillyTavern fork.

The old standalone React/Vite + FastAPI application stack is not the current implementation target.

LWS retains SillyTavern's existing UI/UX language and infrastructure.

Travel consumes fictional time; older instantaneous-travel interpretation is superseded.

## Phase Implementation Status

| Phase | Title | Status | Evidence |
|---|---|---|---|
| **Phase 1** | **LWS Host Foundation** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Unit suite (`tests/living-world/`) passes (21/21 tests); ST full suite passes (432/432 tests); real ST server process lifecycle verified with live HTTP probe; clean shutdown verified; SQLite WAL DB created at `data/living-world/lws.db`. |
| **Phase 2** | **Authored World and Character Model** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 002 applied (`PRAGMA user_version = 2`); exactly 9 authored tables, 12 DB triggers (cross-world relationship integrity & `world_id` immutability), 5 partial indexes; 7 authored domain services; 40+ REST endpoints under `/api/living-world/worlds`; ST V2 character mapped subset; full unit and integration test suites passing (32/32 suites, 499/499 tests); linters clean (0 errors). |
| **Phase 3** | **Simulation Runtime and Persistence** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 003 applied (`PRAGMA user_version = 3`); exactly 2 runtime tables (`lws_simulations`, `lws_simulation_characters`), 10 DB triggers, 5 indexes; Simulation & SimulationCharacter domain services; scenario instantiation with atomic roster snapshotting; Two-Simulation Isolation proven; status transition matrix; semantic calendar date validation; soft-deleted location assignment guards; 10 authenticated REST endpoints; full test suites passing (37/37 suites, 543/543 tests); linters clean (0 errors). |
| **Phase 4** | **Events, Authority, and State Transitions** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 004 applied (`PRAGMA user_version = 4`); tables `lws_events` and `lws_narrative_turns`; exactly 16 DB triggers; exactly 7 DB indexes; closed 29-event taxonomy (23 active Phase 4, 6 deferred Phase 5, 13 stateful); 4-stage authority pipeline; server-enforced provenance; Phase 3 mutation bypasses eliminated; two-transaction savepoint execution with durable rejected-turn persistence; pure in-memory zero-SQL replay engine (`replaySimulation`) with 100% parity verification (`verifySimulationParity`); 7 REST endpoints; 24 test suites / 184 tests passing; linters clean (0 errors); ADR-012 authored. |
| **Phase 5** | **Fictional Time, Schedules, Routines, and Travel** | **IMPLEMENTED & VERIFIED** | Migration 005 applied (`PRAGMA user_version = 5`); exactly 2 new tables (`lws_simulation_character_routines`, `lws_scheduled_events`); exactly 9 Phase 5 DB triggers (1 evolved monotonic clock trigger + 4 routine triggers + 4 scheduled-event triggers; 24 cumulative triggers across system); exactly 4 new indexes (11 cumulative across Phase 4 & 5 tables); closed 29-event taxonomy fully activated (all 29 active, 0 deferred, 19 stateful); discrete timeline resolution engine discovering critical sub-events in $(T_{\text{start}}, T_{\text{target}}]$; 6-tier routine arbitration with severe condition suspension; tree LCA spatial travel with planned departures ($T_{\text{dep}} = T_{\text{start}} - \text{duration}$); reciprocal supersession integrity enforced at DB boundary; One Authoritative Path policy (`POST /events` rejects Phase 5 events with HTTP 422 `DEDICATED_ROUTE_REQUIRED`); pure zero-SQL in-memory replay with 100% parity verification; 8 new REST endpoints; targeted test suite passing (31/31 suites, 241/241 tests); full repository unit suite passing (50/50 suites, 652/652 tests); linters clean (0 errors); ADR-013 authored. |
| Phase 6 | Perception, Knowledge, Memory, and Observation | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 7 | Character Cognition and Decision Making | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 8 | Social Systems and Character Development | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 9 | Living World, Population, Environment, and Emergence | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 10 | Prompt, Context, and ST Generation Integration | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 11 | Import, Normalization, and Authoring Workflow | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 12 | Native SillyTavern User Workflow and UI | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 13 | Replay, Hardening, Release Readiness, Long-Run Verification | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |

### Phase 2 Implementation Details and Scope Distinction

Phase 2 establishes the canonical authored foundation in SQLite under migration `002_authored_model` (`PRAGMA user_version = 2`). The implemented phase encompasses the originally approved plan scope alongside two implementation-level enhancements:

#### 1. Originally Approved Phase 2 Scope
- **Schema & Migrations**: 9 tables (7 entity tables: `lws_worlds`, `lws_characters`, `lws_locations`, `lws_factions`, `lws_scenarios`, `lws_world_rules`, `lws_authored_prompt_configs`; 2 join tables: `lws_character_factions`, `lws_scenario_characters`).
- **Database Boundary Enforcement**: 12 triggers enforcing `world_id` immutability across all 6 child tables, cross-world foreign-key integrity on join tables (`lws_character_factions`, `lws_scenario_characters`), and cross-world `starting_location_id` integrity on `lws_scenarios`.
- **Authored Domain Services**: Full CRUD, validation, and soft-delete capabilities across worlds, characters, locations, factions, scenarios, world rules, and per-world prompt configs.
- **SillyTavern Compatibility**: Supported mapped ST Character Card V2 subset (`name`, `description`, `personality`, `scenario_context` mapped from ST `scenario`, `mes_example`, `author_notes`, `system_prompt_override`, `source_version`, `tags`, `extensions`).
- **REST API & World Gating**: 40+ endpoints under `/api/living-world/worlds/:worldLwsId/*`. Gated API behavior returns `404 {"error": "World not found"}` for any descendant route when the parent world is soft-deleted, leaving underlying DB rows physically intact.
- **Soft-Delete Relationship Semantics**: Adding a soft-deleted character/location returns 404; active member/roster listings filter out soft-deleted entities; removing an existing association succeeds with 204.

#### 2. Implementation-Level Enhancements (Beyond Original Plan)
The implemented Phase 2 contains two capabilities that were not explicitly present in the originally reviewed Phase 2 plan:
- **Enhancement A — Hierarchical Locations**:
  - The authored Location service supports self-referential parent locations (`lws_locations.parent_location_id`).
  - Enables hierarchical authored locations (e.g. World → Region → City → Building → Room).
  - Enforces parent-location validation (ensuring the parent location exists, is active, and belongs to the same world).
  - Performs circular-reference detection in domain validation (rejecting attempts where a location would become an ancestor of itself).
- **Enhancement B — Active Name Uniqueness**:
  - Employs 5 partial unique indexes (`WHERE deleted_at IS NULL` with `COLLATE NOCASE`) in SQLite:
    - `idx_lws_worlds_name_active` on `lws_worlds(name)`
    - `idx_lws_characters_name_active` on `lws_characters(world_id, name)`
    - `idx_lws_locations_name_active` on `lws_locations(world_id, name)`
    - `idx_lws_factions_name_active` on `lws_factions(world_id, name)`
    - `idx_lws_scenarios_name_active` on `lws_scenarios(world_id, name)`
  - Enforces case-insensitive uniqueness of active entity names within their world scope (and global scope for active worlds).
  - Uniqueness is restricted to active records (`deleted_at IS NULL`), allowing a soft-deleted entity's name to be reused by a new active entity.

#### 3. Scope Distinction from Prior Phases
- Phase 2 established solely the authored foundation. Zero mutable runtime simulation state existed prior to Phase 3.

### Phase 3 Implementation Details and Scope Distinction

Phase 3 establishes the canonical simulation runtime persistence layer in SQLite under migration `003_simulation_runtime` (`PRAGMA user_version = 3`).

#### 1. Implemented Phase 3 Scope
- **Schema & Migrations**:
  - `lws_simulations`: Runtime timeline instances scoped to a parent world, referencing an optional originating scenario, storing current fictional ISO 8601 UTC timestamp, lifecycle status (`active`, `paused`, `archived`), and arbitrary settings/extensions JSON.
  - `lws_simulation_characters`: Runtime character instances scoped to a parent simulation and authored character, storing current location, activity, physical condition, runtime state JSON, and an immutable frozen `authored_snapshot` JSON.
- **Database Boundary Enforcement (Exactly 10 Triggers)**:
  1. `trg_lws_simulations_world_id_immutable`: Blocks mutating `world_id` on simulations.
  2. `trg_lws_simulations_scenario_id_immutable`: Blocks mutating `scenario_id` on simulations.
  3. `trg_lws_simulations_scenario_same_world_insert`: Verifies scenario belongs to the same world upon insertion.
  4. `trg_lws_simulations_status_transition`: Enforces the explicit lifecycle matrix (`active` ⇄ `paused`, `active`/`paused` → `archived`, `archived` terminal).
  5. `trg_lws_sim_chars_simulation_id_immutable`: Blocks mutating `simulation_id` on runtime characters.
  6. `trg_lws_sim_chars_character_id_immutable`: Blocks mutating `character_id` on runtime characters.
  7. `trg_lws_sim_chars_authored_snapshot_immutable`: Blocks mutating `authored_snapshot` on runtime characters.
  8. `trg_lws_sim_chars_same_world_insert`: Verifies authored character belongs to simulation's world upon insertion.
  9. `trg_lws_sim_chars_location_insert`: Verifies location belongs to simulation's world and blocks newly assigning a soft-deleted location on insertion.
  10. `trg_lws_sim_chars_location_update`: Verifies location belongs to simulation's world and blocks newly assigning a soft-deleted location on update, while preserving existing references.
- **Performance and Partial Indexes (Exactly 5 Indexes)**:
  - `idx_lws_simulations_world` on `lws_simulations(world_id) WHERE deleted_at IS NULL`
  - `idx_lws_simulations_name_active` (partial unique index on `lws_simulations(world_id, name COLLATE NOCASE) WHERE deleted_at IS NULL`)
  - `idx_lws_sim_chars_sim` on `lws_simulation_characters(simulation_id) WHERE deleted_at IS NULL`
  - `idx_lws_sim_chars_unique_active` (partial unique index on `lws_simulation_characters(simulation_id, character_id) WHERE deleted_at IS NULL`)
  - `idx_lws_sim_chars_location` on `lws_simulation_characters(current_location_id) WHERE deleted_at IS NULL`
- **Domain Services**:
  - `simulations.js`: Simulation CRUD, scenario instantiation with atomic roster creation, status transition validation, and soft-deletion (allowed from `active`, `paused`, `archived`). Simulation soft-deletion sets `deleted_at = isoNow()`; child `lws_simulation_characters` rows remain physically intact in SQLite for audit and replay, while child routes return 404 via parent simulation status gating. `updateSimulation` permits updating `name`, `status`, `settings`, and `extensions`, while rejecting attempts to modify `world_id`, `scenario_id`, or `current_fictional_time` with HTTP 400.
  - `simulation-characters.js`: SimulationCharacter CRUD, runtime state mutations (`current_location_id`, `activity`, `physical_condition`, `runtime_state`), duplicate active character conflict rejection (409), paused/archived mutation protection, soft-deleted location assignment guards, and soft-delete.
  - `common.js`: Semantic calendar validation (`validateFictionalTimestamp`) validating Gregorian leap years, days in month, and 24h clock bounds; status transition validation; and active world/simulation lookup.
- **Hybrid Runtime Character Identity (ADR-011)**:
  - Runtime instance maintains independent identity, foreign key lineage to `lws_characters`, and a frozen immutable snapshot of authored fields captured at instantiation.
  - Runtime mutations never alter or write to `lws_characters`.
- **Two-Simulation Isolation Proof**:
  - Verified that two concurrent simulations in the same world progress independently with different locations, activities, and conditions without state collision, and verified that soft-deleting authored cards does not corrupt running simulations.
- **REST Transport (10 Endpoints)**:
  - Fully authenticated routes mounted in `src/endpoints/living-world.js` for simulation and simulation character CRUD and queries, protected with deleted-World and deleted-Simulation gating. In `PATCH /simulations/:simLwsId`, `current_fictional_time` cannot be mutated (attempts return HTTP 400).

### Phase 4 Implementation Details and Scope Distinction

Phase 4 establishes the authoritative event ledger, narrative turn savepoint model, authority evaluation pipeline, and deterministic replay engine in SQLite under migration `004_events_and_authority` (`PRAGMA user_version = 4`).

#### 1. Implemented Phase 4 Scope
- **Schema & Migrations**:
  - `lws_narrative_turns`: Narrative turn tracking referencing chat/prompt IDs, execution status (`pending`, `committed`, `rejected`), error details, and extensions JSON.
  - `lws_events`: Authoritative, append-only event ledger tracking simulation sequences, closed event types, fictional timestamps, actors, targets, locations, narrative turn association, causal event links, structured payload, provenance, and SHA-256 idempotency keys.
- **Database Boundary Enforcement (Exactly 16 Triggers)**:
  1. `trg_lws_events_immutable_all`: Rejects direct `UPDATE` on `lws_events`.
  2. `trg_lws_events_no_delete`: Rejects direct `DELETE` on `lws_events`.
  3. `trg_lws_events_same_sim_actor`: Enforces that `actor_character_id` belongs to the same simulation as the event.
  4. `trg_lws_events_same_sim_target`: Enforces that `target_character_id` belongs to the same simulation as the event.
  5. `trg_lws_events_same_world_authored`: Enforces that `authored_character_id` belongs to the same world as the simulation.
  6. `trg_lws_events_same_world_location`: Enforces that `location_id` belongs to the same world as the simulation.
  7. `trg_lws_events_fictional_time_matches_sim`: Enforces that event `fictional_time` matches parent simulation `current_fictional_time`.
  8. `trg_lws_events_causal_integrity`: Enforces that `causal_event_id` belongs to the same simulation and has a strictly preceding sequence (`sequence_number < NEW.sequence_number`).
  9. `trg_lws_events_same_sim_turn`: Enforces that `turn_id` belongs to the same simulation as the event.
  10. `trg_lws_events_char_actor_required`: Requires `actor_character_id` on character-specific state events.
  11. `trg_lws_events_start_actor_prohibited`: Prohibits `actor_character_id` or `target_character_id` on `SIMULATION_START`.
  12. `trg_lws_events_join_authored_required`: Requires `authored_character_id` on `CHARACTER_JOIN`.
  13. `trg_lws_narrative_turns_sim_immutable`: Prohibits mutating `simulation_id` on narrative turns.
  14. `trg_lws_narrative_turns_turn_num_immutable`: Prohibits mutating `turn_number` on narrative turns.
  15. `trg_lws_narrative_turns_terminal_immutable`: Enforces terminal turn states (`committed`, `rejected`, `failed` turns cannot be mutated).
  16. `trg_lws_narrative_turns_no_delete`: Rejects direct `DELETE` on narrative turns.
- **Indexes (Exactly 7 Indexes)**:
  - `idx_lws_events_sim_seq` (unique), `idx_lws_events_sim_time`, `idx_lws_events_actor`, `idx_lws_events_authored_char`, `idx_lws_events_idempotency` (unique), `idx_lws_events_turn`, `idx_lws_narrative_turns_sim_turn` (unique).
- **Closed 29-Event Taxonomy**:
  - 23 active Phase 4 events, 6 deferred Phase 5 events, exactly 13 stateful events projecting into SQLite runtime tables.
- **Four-Stage Authority Evaluation Pipeline**:
  - Evaluates Schema (Stage 1), Structural & Provenance checks (Stage 2: server-enforced provenance blocking client forgery of `system`, `simulation_engine`, and unauthorized `director`), Domain rules (Stage 3), and Authority Decision (Stage 4).
- **Elimination of Phase 3 Mutation Bypasses**:
  - Direct updates to `lws_simulations` and `lws_simulation_characters` are eliminated; all runtime mutations delegate strictly through `commitEvent`.
- **Two-Transaction Savepoint Execution for Narrative Turns**:
  - Transaction A commits turn record; Transaction B runs under `SAVEPOINT proposal_batch`. Failures roll back proposal mutations while preserving durable rejected turn audits with `error_details` (HTTP 422).
- **Pure In-Memory Zero-SQL Replay Engine**:
  - `replaySimulation(events)` folds event history in pure memory without SQL queries.
  - `verifySimulationParity(simLwsId)` verifies 100% attribute parity against projected SQLite rows via `POST /api/living-world/simulations/:simLwsId/replay-verify`.
- **REST API (7 Endpoints)**:
  - Mounts narrative turn execution, queries, event emission, listing, detail, and replay verification (`POST .../replay-verify`) endpoints under `/api/living-world/simulations/:simLwsId/*`.

### Phase 5 Implementation Details and Scope Distinction

Phase 5 delivers fictional time progression, character routine arbitration, spatial travel, and scheduled world events under migration `005_time_and_schedules` (`PRAGMA user_version = 5`).

#### 1. Implemented Phase 5 Scope
- **Schema & Migrations (Migration 005)**:
  - `lws_simulation_character_routines`: Persistent character schedule blocks supporting 24h start/end times, overnight wrapping, day of week specificity, priority ranking, flexibility, enabled flag, and target location.
  - `lws_scheduled_events`: World event schedule tracking target location, scheduled fictional timestamp, status lifecycle (`pending`, `triggered`, `cancelled`, `superseded`), payload JSON, and supersession links.
- **Database Boundary Hardening (Cumulative 24 Triggers)**:
  - 9 Phase 5 trigger objects:
    1. `trg_lws_events_monotonic_and_sequence`: Enforces sequence monotonicity, clock non-retroactivity, and unbroken sequences on `lws_events`.
    2. `trg_lws_routines_immutability`: Enforces immutability of `simulation_id` and `simulation_character_id`.
    3. `trg_lws_routines_integrity`: Validates character simulation membership and active world location existence.
    4. `trg_lws_routines_no_delete`: Enforces soft-delete only for routines.
    5. `trg_lws_sched_events_immutability`: Enforces immutability of `simulation_id`.
    6. `trg_lws_sched_events_terminal_immutable`: Freezes terminal events (`triggered`, `cancelled`, `superseded`).
    7. `trg_lws_sched_events_integrity`: Validates active location, same-simulation supersession, and trigger/cancel event linkages.
    8. `trg_lws_sched_events_reciprocal_supersession`: Enforces bidirectional supersession locking ($A.\text{superseded\_by} = B \iff B.\text{supersedes} = A$) and status `superseded` at the DB boundary.
    9. `trg_lws_sched_events_no_delete`: Prohibits direct `DELETE` on scheduled events.
- **Indexes (Cumulative 11 Indexes)**:
  - 4 Phase 5 indexes: `idx_lws_routines_sim_char`, `idx_lws_routines_lookup`, `idx_lws_sched_events_sim_time` (`WHERE status = 'pending'`), `idx_lws_sched_events_sim_status`.
- **Closed 29-Event Taxonomy**:
  - All 29 event types active (0 deferred, 19 stateful).
  - Generic `POST /events` rejects all 6 Phase 5 events with HTTP 422 `DEDICATED_ROUTE_REQUIRED`.
- **Discrete Timeline Advancement & Discovery Engine**:
  - `POST /simulations/:simLwsId/time-advance` gathers scheduled event triggers, planned routine travel departures ($T_{\text{dep}} = T_{\text{start}} - \text{duration}$), and in-transit arrivals in $(T_{\text{start}}, T_{\text{target}}]$.
  - Deterministic sub-event sequence ordering: $(T_{\text{point}} \text{ asc}, \text{sub-event priority asc}, \text{entity\_id asc})$.
  - Zero-duration advance idempotence ($T_{\text{start}} = T_{\text{target}}$ generates 0 consequence events and 0 ledger mutations).
- **6-Tier Routine Arbitration & Severe Condition Suspension**:
  - Severe physical condition (Tier 1) suspends travel and routines.
  - Recovers travel upon condition resolution if destination routine remains active.
- **Tree LCA Spatial Travel**:
  - Hierarchical tree LCA distance calculation with connection override lookups.
  - Complete travel lifecycle with planned departures, in-transit runtime tracking, and arrival relocations.
- **Pure Replay & Deep Parity**:
  - `simulationReducer` handles all 6 Phase 5 events in pure memory with zero SQL.
  - `verifySimulationParity` proves 100% attribute parity across simulations, characters, routines, and scheduled events with zero drift.
- **REST API (8 New Endpoints)**:
  - Mounts time advance (`POST .../time-advance`), routine management (`GET/PUT .../routines`), scheduled event lifecycle (`POST .../scheduled-events`, `GET .../scheduled-events`, `GET .../scheduled-events/:id`, `POST .../scheduled-events/:id/cancel`, `POST .../scheduled-events/:id/supersede`).

#### 2. Future Scope Distinction (Phase 6+)
- **Phase 6 Future Scope**: Perception, knowledge, memory, and observation subsystems. Filtering character knowledge by physical location and observation boundaries.

## Status labels

- DESIGNED — documented but not implemented;
- IMPLEMENTED — code exists;
- VERIFIED — backed by relevant tests/checks;
- ACCEPTED — reviewed and accepted;
- PARTIAL — some behavior exists but acceptance is incomplete;
- BLOCKED — cannot proceed without a missing decision/dependency;
- UNKNOWN — not verified from repository evidence.

## Important

Do not infer completion from documentation. Inspect source/tests/runtime evidence.
