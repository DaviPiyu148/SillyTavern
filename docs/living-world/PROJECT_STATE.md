# LWS Project State

## As-of

2026-09-26.

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
| **Phase 5** | **Fictional Time, Schedules, Routines, and Travel** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 005 applied (`PRAGMA user_version = 5`); exactly 2 new tables (`lws_simulation_character_routines`, `lws_scheduled_events`); exactly 9 Phase 5 DB triggers (1 evolved monotonic clock trigger + 4 routine triggers + 4 scheduled-event triggers; 24 cumulative triggers across system); exactly 4 new indexes (11 cumulative across Phase 4 & 5 tables); closed 29-event taxonomy fully activated (all 29 active, 0 deferred, 19 stateful); discrete timeline resolution engine discovering critical sub-events in $(T_{\text{start}}, T_{\text{target}}]$; 6-tier routine arbitration with severe condition suspension; tree LCA spatial travel with planned departures ($T_{\text{dep}} = T_{\text{start}} - \text{duration}$); reciprocal supersession integrity enforced at DB boundary; One Authoritative Path policy (`POST /events` rejects Phase 5 events with HTTP 422 `DEDICATED_ROUTE_REQUIRED`); pure zero-SQL in-memory replay with 100% parity verification; 8 new REST endpoints; targeted test suite passing (31/31 suites, 241/241 tests); full repository unit suite passing (50/50 suites, 652/652 tests); linters clean (0 errors); ADR-013 authored. |
| **Phase 6** | **Perception, Knowledge, Memory, and Observation** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 006 applied (`PRAGMA user_version = 6`); exactly 5 new tables (`lws_event_perceptions`, `lws_character_knowledge`, `lws_character_memories`, `lws_character_beliefs`, `lws_simulation_cameras`); exactly 15 Phase 6 DB triggers (39 cumulative across system); exactly 10 new indexes (21 cumulative across Phase 4–6 tables); spatial sensory perception engine with tree LCA distance and Option A canonical modality precedence (`tactile > visual > auditory > olfactory`); subjective character knowledge acquisition with deterministic provenance tracking; character memories with relevance-bounded retrieval ($N \le 100$, $\tau = 604800\,\text{s}$, exact weights $0.25/0.25/0.20/0.30$); character beliefs ($1 \le \text{confidence} \le 100$) with `DIRECTOR_MODIFY_STATE` mutation support; multi-mode simulation cameras (`follow_character`, `observe_location`, `god_view`) with privileged Observer Perspective (`GET /observer/perspective`) vs non-omniscient character perspective; pure zero-SQL in-memory replay parity across all Phase 6 tables using deterministic SHA-256 UUID derivation; exactly 13 Phase 6 REST endpoints; targeted test suite passing (39/39 suites, 285/285 tests); full repository unit suite passing (58/58 suites, 696/696 tests); linters clean (0 errors); ADR-014 authored. |
| **Phase 7** | **Character Cognition and Decision Making** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 007 applied (`PRAGMA user_version = 7`); exactly 5 new tables (`lws_character_needs`, `lws_character_goals`, `lws_character_intentions`, `lws_character_values`, `lws_character_emotions`); exactly 15 Phase 7 DB triggers (54 cumulative across system); exactly 10 new indexes (31 cumulative across Phase 4–7 tables); 8 cognition modules; 5 need dimensions (`energy`, `nourishment`, `social`, `safety`, `morale`); goal lifecycle with 100% event-backed mutations via `UPDATE_RUNTIME_STATE`; dual sequence intentions; values with hard moral veto; emotions with hyperbolic decay; deliberation composite scoring; Tier 3 `GOAL_PURSUIT` arbitration; pure zero-SQL replay; 9 REST endpoints; ADR-015 authored. |
| **Phase 8** | **Social Systems and Character Development** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 008 applied (`PRAGMA user_version = 8`); exactly 5 new runtime tables (`lws_character_relationships`, `lws_relationship_evidence`, `lws_social_information`, `lws_character_faction_memberships`, `lws_character_development_records`); exactly 15 Phase 8 DB triggers (70 cumulative across Phase 4–8 tables); exactly 10 new indexes (41 cumulative across Phase 4–8 tables); 6 social modules in `src/living-world/social/`; directional asymmetric relationship graphs with 5 dimensions (`trust`, `affection`, `familiarity`, `respect`, `loyalty`); 30-day exponential familiarity decay with 7-day grace period ($\tau = 30\,\text{days}$); append-only interaction evidence ledger; rumor transmission trees with 17 topology invariant tests (13 negative + 4 positive) and bounded depth ($0..5$); trust-gated subjective belief adoption; non-hive runtime faction memberships with individual values/needs/beliefs; causal character development ledger requiring verifiable causal events with dual-store projection; cognition scoring extensions ($U_{\text{social}}$) with moral veto precedence; pure in-memory zero-SQL replay engine with 100% field-level parity verification across all 5 Phase 8 tables + beliefs; 11 Tri-Tier REST API routes; targeted test suite passing (8 dedicated Phase 8 suites, 58 tests); full repository Living World unit suite passing (54/54 suites, 400/400 tests); linters clean (0 errors); ADR-016 authored. |
| **Phase 9** | **Living World, Population, Environment, and Emergence** | **IMPLEMENTED, VERIFIED, ACCEPTED** | Migration 009 applied (`PRAGMA user_version = 9`); exactly 5 new runtime tables (`lws_location_environmental_profiles`, `lws_location_operational_states`, `lws_ambient_population_archetypes`, `lws_simulation_character_tiers`, `lws_promoted_entities`); exactly 15 Phase 9 DB triggers (85 cumulative across Phase 4–9 tables); exactly 10 new indexes (51 cumulative across Phase 4–9 tables); Environment subsystem (`environment.js`, `operational-states.js`); Population subsystem (`archetypes.js`, `ambient-generator.js`, `promotion.js`, `character-tiers.js`); deterministic procedural ambient population with transient IDs; dynamic entity promotion pipeline with proof-of-existence transient validation and atomic `CHARACTER_JOIN`; Core / Supporting / Ambient population tiering with cognitive budgeting; sensory clarity scoring ($0..100$) and travel / perception modifiers; pure zero-SQL replay engine parity across all 14 authoritative tables; 12 Tri-Tier REST endpoints; 9 dedicated Phase 9 test suites (37 tests) passing; full Living World unit suite passing (63/63 suites, 437/437 tests); full repository suite passing (82/82 suites, 848/848 tests); ADR-017 authored. |
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
    2. `trg_lws_routines_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on routine updates.
    3. `trg_lws_routines_char_same_sim`: Validates character simulation membership and active world location existence on insertion.
    4. `trg_lws_routines_same_world_loc`: Validates that updated target location belongs to simulation world and is not soft-deleted.
    5. `trg_lws_routines_no_delete`: Enforces soft-delete only for routines.
    6. `trg_lws_sched_events_sim_immutable`: Validates location, self-supersession, predecessor status (`pending`), reciprocal successor linkage, and trigger/cancel linkages on insertion.
    7. `trg_lws_sched_events_terminal_immutable`: Freezes terminal events (`triggered`, `cancelled`, `superseded`).
    8. `trg_lws_sched_events_integrity`: Enforces simulation immutability, location validity, immutable established supersession, reciprocal supersession consistency, and trigger/cancel linkages on update.
    9. `trg_lws_sched_events_no_delete`: Prohibits direct `DELETE` on scheduled events.
- **Indexes (Cumulative 11 Indexes)**:
  - 4 Phase 5 indexes: `idx_lws_routines_sim_char`, `idx_lws_routines_lookup`, `idx_lws_sched_events_sim_time` (`WHERE status = 'pending'`), `idx_lws_sched_events_sim_status`.
- **Cumulative Database Inventory**:
  - Exactly 16 tables (reconciling the frozen plan Section 14.2 text erratum stating "15 tables (13 from Phases 1–4 + 2 new)", which omitted `lws_meta` or undercounted the 14 verified Phase 1–4 tables; 14 prior tables + 2 Phase 5 tables = 16 total tables), exactly 24 triggers on Phase 4/5 tables, and exactly 11 indexes.
- **Closed 29-Event Taxonomy**:
  - All 29 event types active (0 deferred, 19 stateful).
  - Generic `POST /events` rejects all 6 Phase 5 events with HTTP 422 `DEDICATED_ROUTE_REQUIRED`.
- **Discrete Timeline Advancement & Discovery Engine**:
  - `POST /simulations/:simLwsId/time-advance` gathers scheduled event triggers, planned routine travel departures ($T_{\text{dep}} = T_{\text{start}} - \text{duration}$), and in-transit arrivals in $(T_{\text{start}}, T_{\text{target}}]$.
  - Deterministic sub-event sequence ordering: $(T_{\text{point}} \text{ asc}, \text{sub-event priority asc}, \text{entity\_id asc})$.
  - Zero-duration advance idempotence ($T_{\text{start}} = T_{\text{target}}$ generates 0 consequence events and 0 ledger mutations).
- **Six-Tier Routine Arbitration & Severe Condition Suspension**:
  - Deterministic activity arbitration across 6 tiers: Tier 1 `DIRECTOR_OVERRIDE`, Tier 2 `INTERRUPTED` (severe physical condition), Tier 3 `GOAL_PURSUIT` (reserved Phase 7), Tier 4 `TRAVEL` (in-transit), Tier 5 `ROUTINE` (matching schedule block), Tier 6 `IDLE` (fallback).
  - Severe physical condition (Tier 2) suspends travel and routines; recovers travel upon condition resolution if destination routine remains active.
- **Tree LCA Spatial Travel**:
  - Hierarchical tree LCA distance calculation with connection override lookups.
  - Complete travel lifecycle with planned departures, in-transit runtime tracking, and arrival relocations.
- **Pure Replay & Deep Parity**:
  - `simulationReducer` handles all 6 Phase 5 events in pure memory with zero SQL.
  - `verifySimulationParity` proves 100% attribute parity across simulations, characters, routines, and scheduled events with zero drift.
- **REST API (8 New Endpoints)**:
  - Mounts time advance (`POST .../time-advance`), routine management (`GET/PUT .../routines`), scheduled event lifecycle (`POST .../scheduled-events`, `GET .../scheduled-events`, `GET .../scheduled-events/:id`, `POST .../scheduled-events/:id/cancel`, `POST .../scheduled-events/:id/supersede`).

#### 2. Scope Distinction from Prior Phases
- Phase 5 activated the temporal runtime, 6-tier routines, and travel mechanics. Character perception, subjective knowledge, memory formation, beliefs, and camera perspectives remained designed until Phase 6.

### Phase 6 Implementation Details and Scope Distinction

Phase 6 establishes perception, knowledge, memory, beliefs, and observation subsystems in SQLite under migration `006_perception_and_knowledge` (`PRAGMA user_version = 6`).

#### 1. Implemented Phase 6 Scope
- **Schema & Migrations (Migration 006)**:
  - `lws_event_perceptions`: Immutable character event perception ledger with sensory modalities.
  - `lws_character_knowledge`: Subjective character knowledge facts with causal provenance and soft deletion.
  - `lws_character_memories`: Character episodic/semantic memory records with emotional salience, importance, confidence, status, tags, and soft deletion.
  - `lws_character_beliefs`: Character beliefs and suspicions with confidence ($1..100$), source basis, and causal event linking.
  - `lws_simulation_cameras`: Multi-mode simulation camera states (`follow_character`, `observe_location`, `god_view`) with immutable camera names and simulation scoping.
- **Database Boundary Hardening (Cumulative 39 Triggers)**:
  - Exactly 15 Phase 6 trigger objects:
    1. `trg_lws_perceptions_immutable`: Prohibits direct updates on `lws_event_perceptions`.
    2. `trg_lws_perceptions_no_delete`: Prohibits direct physical `DELETE` on `lws_event_perceptions`.
    3. `trg_lws_perceptions_same_sim`: Validates event and character belong to perception simulation.
    4. `trg_lws_knowledge_identity_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on knowledge.
    5. `trg_lws_knowledge_insert_integrity`: Validates character, source character, and source event belong to simulation on knowledge insertion.
    6. `trg_lws_knowledge_no_delete`: Prohibits direct physical `DELETE` on knowledge (requires soft-delete).
    7. `trg_lws_memories_identity_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on memories.
    8. `trg_lws_memories_insert_integrity`: Validates character and event reference belong to simulation on memory insertion.
    9. `trg_lws_memories_no_delete`: Prohibits direct physical `DELETE` on memories (requires soft-delete).
    10. `trg_lws_beliefs_identity_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on beliefs.
    11. `trg_lws_beliefs_insert_integrity`: Validates character and causal event reference belong to simulation on belief insertion.
    12. `trg_lws_beliefs_no_delete`: Prohibits direct physical `DELETE` on beliefs (requires soft-delete).
    13. `trg_lws_cameras_identity_immutable`: Enforces immutability of `simulation_id` and `camera_name` on `lws_simulation_cameras`.
    14. `trg_lws_cameras_insert_integrity`: Validates mode/target invariants and cross-simulation lineage on camera insertion.
    15. `trg_lws_cameras_update_integrity`: Validates mode/target invariants and cross-simulation lineage on camera update.
- **Indexes (Cumulative 21 Indexes)**:
  - Exactly 10 Phase 6 indexes: `idx_lws_perceptions_event`, `idx_lws_perceptions_char_time`, `idx_lws_knowledge_char_lookup`, `idx_lws_knowledge_sim_char`, `idx_lws_memories_char_time`, `idx_lws_memories_char_salience`, `idx_lws_memories_sim_char`, `idx_lws_beliefs_lookup`, `idx_lws_beliefs_sim_char`, `idx_lws_cameras_sim`.
- **Spatial Sensory Perception Engine**:
  - Tree LCA distance calculation evaluating physical reachability across tree hierarchy.
  - Option A canonical modality precedence: $\text{tactile} > \text{visual} > \text{auditory} > \text{olfactory}$.
  - Strictly single-modality persistence per `(event, character)`; storage of `omniscience_director` strictly forbidden in `lws_event_perceptions`.
- **Subjective Knowledge & Causal Evidence**:
  - Knowledge extraction from event payloads (`COMMUNICATE`, `OBSERVE`, `INTERACT_OBJECT`, `DIRECTOR_MODIFY_STATE`).
  - Strict preservation of causal provenance (`source_channel`, `source_character_id`, `source_event_id`, `fictional_time_acquired`).
- **Character Memories & Relevance Scoring**:
  - Relevance-bounded retrieval algorithm with $N \le 100$ candidate bound and $\tau = 604800\,\text{s}$:
    $$S_{\text{total}} = 0.25 \cdot \text{Recency} + 0.25 \cdot \text{Salience} + 0.20 \cdot \text{Importance} + 0.30 \cdot \text{Context}$$
    where $\text{Recency} = \frac{1}{1 + \frac{\Delta t}{604800}}$ ($\Delta t = \text{secondsBetween}(M.\text{fictional\_time}, T_{\text{now}})$).
  - Deterministic tie-breaking: $S_{\text{total}}$ DESC, $M.\text{fictional\_time}$ DESC, $M.\text{lws\_id}$ ASC.
  - Mutable patching for allowed fields only (`summary`, `details`, `emotional_salience`, `importance`, `confidence`, `status`, `tags`, `deleted_at`), preserving immutable causal fields.
- **Character Beliefs & Suspicions**:
  - Schema persistence: `subject_key`, `belief_type`, `statement`, `confidence`, `source_basis`, `causal_event_id`, `deleted_at`.
  - Confidence integer bounds: $1 \le \text{confidence} \le 100$.
  - Authoritative mutation via `DIRECTOR_MODIFY_STATE` and event payloads.
- **Simulation Cameras & Perspectives**:
  - Camera tracking supporting modes: `follow_character`, `observe_location`, `god_view`.
  - **Privileged Observer Perspective** (`GET /api/living-world/simulations/:simLwsId/observer/perspective`): Omniscient ground truth directly from simulation state.
  - **Subjective Character Perspective** (`GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/perspective`): Strictly non-omniscient perspective filtered by perceptions, active knowledge, memories, and beliefs.
- **Deterministic Derivations & Pure Zero-SQL Replay**:
  - Deterministic UUIDs generated via SHA-256 namespace hashing `generateDeterministicUuid(namespace, ...parts)`.
  - `simulationReducer` reconstructs perceptions, knowledge, memories, beliefs, and camera state in-memory with zero SQL queries.
  - `verifySimulationParity` proves 100% attribute parity with database state.
- **REST API (Exactly 13 Endpoints)**:
  - Mounts 13 Phase 6 REST endpoints under `/api/living-world/simulations/:simLwsId/...`.

### Phase 7 Implementation Details and Scope Distinction

Phase 7 establishes autonomous character cognition, goal lifecycles, intention tracking, personality values, emotional dynamics, and internal deliberation in SQLite under migration `007_cognition_and_decisions` (`PRAGMA user_version = 7`).

#### 1. Implemented Phase 7 Scope
- **Schema & Migrations (Migration 007)**:
  - `lws_character_needs`: Tracks physiological and psychological need levels (5 dimensions: `energy`, `nourishment`, `social`, `safety`, `morale` clamped to $[0, 100]$), decay/recovery rates, and last update fictional timestamps.
  - `lws_character_goals`: Hierarchical goal management (`proposed`, `active`, `suspended`, `completed`, `abandoned`) with priority, urgency, parent-child goal linkages, optional permanent `client_goal_key`, and soft-deletion tracking.
  - `lws_character_intentions`: Concrete action commitments (`pending`, `executing`, `completed`, `failed`, `cancelled`) with dual sequence ordering (simulation-wide sequence and character-scoped sequence), plan steps, and execution linkages.
  - `lws_character_values`: Character core personality values (6 dimensions: `honesty`, `courage`, `compassion`, `ambition`, `loyalty`, `curiosity` clamped to $[-100, 100]$) with weights and stability coefficients.
  - `lws_character_emotions`: Subjective emotional states with primary emotion types, valence, arousal, peak intensity, and hyperbolic decay anchors.
- **Database Boundary Hardening (Cumulative 55 Triggers)**:
  - Exactly 15 Phase 7 trigger objects:
    1. `trg_lws_needs_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on needs.
    2. `trg_lws_needs_insert_integrity`: Validates character belongs to simulation on need insertion.
    3. `trg_lws_needs_no_delete`: Prohibits direct physical `DELETE` on needs.
    4. `trg_lws_goals_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on goals.
    5. `trg_lws_goals_insert_integrity`: Validates character belongs to simulation and parent goal consistency on insertion.
    6. `trg_lws_goals_terminal_immutable`: Freezes terminal goals (`completed`, `abandoned`).
    7. `trg_lws_goals_no_delete`: Prohibits direct physical `DELETE` on goals (requires soft-delete).
    8. `trg_lws_intentions_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on intentions.
    9. `trg_lws_intentions_insert_integrity`: Validates character, goal, and event reference belong to simulation on intention insertion.
    10. `trg_lws_intentions_terminal_immutable`: Freezes terminal intentions (`completed`, `failed`, `cancelled`).
    11. `trg_lws_intentions_no_delete`: Prohibits direct physical `DELETE` on intentions.
    12. `trg_lws_values_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on values.
    13. `trg_lws_values_insert_integrity`: Validates character belongs to simulation on value insertion.
    14. `trg_lws_values_no_delete`: Prohibits direct physical `DELETE` on values.
    15. `trg_lws_emotions_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on emotions.
- **Indexes (Cumulative 31 Indexes across Phase 4–7 Tables)**:
  - Exactly 10 Phase 7 indexes: `idx_lws_needs_sim_char`, `idx_lws_goals_sim_char`, `idx_lws_goals_status`, `idx_lws_goals_client_key_unique` (non-partial unique index on non-null `client_goal_key`), `idx_lws_intentions_sim_char`, `idx_lws_intentions_status`, `idx_lws_intentions_char_seq` (unique per character sequence), `idx_lws_values_sim_char`, `idx_lws_emotions_sim_char`, `idx_lws_emotions_char_time`.
- **Cognition Modules & Decision Architecture**:
  - Implemented across 8 modules in `src/living-world/cognition/`: `arbitration.js`, `common.js`, `deliberation.js`, `emotions.js`, `goals.js`, `intentions.js`, `needs.js`, `values.js`.
  - **Needs Dynamics**: Physiological and psychological need tracking across 5 core dimensions with rate-of-change formulas and acute thresholds ($< 20$). *Note on domain helper*: `evaluateAcuteNeeds()` is a retained direct-SQL domain helper currently reachable only from Phase 7 tests, with no observed production caller. (Architectural warning: this helper must not be introduced into authoritative production simulation execution paths because it mutates state outside the event ledger).
  - **Goals & Event-Backed Mutations**: 100% event-backed goal mutations via `UPDATE_RUNTIME_STATE` (P0-1 correction). Direct SQL mutations on `lws_character_goals` outside the event pipeline are eliminated. Transitioning a goal to terminal states (`completed`, `abandoned`) automatically cancels active child intentions. Permanent client goal uniqueness is enforced across all states.
  - **Intentions & Dual Sequence Model**: Deterministic per-character sequence numbers alongside simulation sequence numbers. Failed intentions persist failure state and error reason via `UPDATE_RUNTIME_STATE` (Option B).
  - **Values & Hard Moral Veto**: Core value alignments $[-100, 100]$ across 6 dimensions. Hard moral veto triggers when an action violates a high positive value ($\ge +75$), causing rejection during deliberation.
  - **Emotional Dynamics**: Subjective emotional states subject to hyperbolic decay ($I(t) = \frac{I_0}{1 + \Delta t / \tau}$, $\tau = 14400\,\text{s}$).
  - **Deliberation & Composite Scoring**: Evaluates candidate actions using a composite score incorporating need satisfaction, value alignment, emotional congruence, and plan feasibility.
  - **Six-Tier Routine Arbitration**: Activates Tier 3 `GOAL_PURSUIT`, arbitrating between Tier 1 `DIRECTOR_OVERRIDE`, Tier 2 `INTERRUPTED`, Tier 3 `GOAL_PURSUIT`, Tier 4 `TRAVEL`, Tier 5 `ROUTINE`, and Tier 6 `IDLE`.
- **Pure Replay & Field-Level Parity**:
  - `simulationReducer` in `src/living-world/events/replay.js` handles all cognition state transitions in pure memory with zero SQL queries.
  - `verifySimulationParity` proves 100% tested field-level parity for the declared Phase 7 cognition state across all 5 cognition tables with zero drift.
- **REST API (Exact 9-Route Contract)**:
  - Mounts 9 Phase 7 cognition REST endpoints under `/api/living-world/simulations/:simLwsId/characters/:charLwsId/...` (needs, goals, intentions, values, emotions, deliberation, and perspective). Conforms to exact contract without direct `DELETE /goals/:id` route; soft-deletion is performed via `PATCH /goals/:id` with `{ is_deleted: true }` (P0-2 contract closure).
- **Verified Git Lineage**:
  - `3e0d3279338561040cfc44ed06fb522cf8116afe` (Phase 6 Accepted)
  - `e1709ce9ca17e44c592811a255e99de41263e009` (Phase 7 Initial Implementation)
  - `f2212206a37d01885ac97cf538060fdcedfb14b1` (Phase 7 Final Contract Closure)

### Phase 8 Implementation Details and Scope Distinction

Phase 8 establishes directional asymmetric relationships, an append-only interaction evidence ledger, acyclic rumor transmission trees with bounded depth, non-hive runtime faction memberships, causal character development with dual-store projection, and $U_{\text{social}}$ cognitive deliberation in SQLite under migration `008_social_and_development` (`PRAGMA user_version = 8`).

#### 1. Implemented Phase 8 Scope
- **Schema & Migrations (Migration 008)**:
  - `lws_character_relationships`: Directional pairwise edges tracking `trust` $[-100, 100]$, `affection` $[-100, 100]$, `familiarity` $[0, 100]$, `respect` $[-100, 100]$, `loyalty` $[-100, 100]$, and `last_interaction_fictional_time`.
  - `lws_relationship_evidence`: Append-only causal interaction ledger tracking `causal_event_id`, `fictional_time`, dimension deltas, `interaction_type`, and `narrative_rationale`.
  - `lws_social_information`: Rumor repository tracking acyclic tree topology (`parent_social_information_id`, `root_social_information_id`, `originator_character_id`, `transmitter_character_id`, `recipient_character_id`, `causal_event_id`), veracity, distortion, depth ($0..5$), and confidence.
  - `lws_character_faction_memberships`: Runtime faction memberships tracking `rank_role`, `standing` $[-100, 100]$, `loyalty_score` $[0, 100]$, `membership_status` (`active`, `probation`, `suspended`, `exiled`, `defected`), and `joined_fictional_time`.
  - `lws_character_development_records`: Causal ledger of permanent character psychological/behavioral shifts tracking `dimension_category`, `dimension_key`, `previous_value`, `new_value`, `delta`, `trigger_category`, `causal_event_ids`, and `stability`.
- **Database Boundary Hardening (Cumulative 70 Triggers)**:
  - Exactly 15 Phase 8 triggers enforcing immutability of parent simulation and character references, prohibiting direct physical DELETE across all 5 tables, and enforcing immutable append-only semantics for evidence, social information, and development records.
- **Indexes (Cumulative 41 Indexes across Phase 4–8 Tables)**:
  - Exactly 10 Phase 8 indexes optimizing pairwise relationship lookups, simulation-scoped evidence listing, topic/subject-key rumor filtering, faction member searches, and character development history.
- **Social Modules & Integration**:
  - Implemented across 6 modules in `src/living-world/social/`: `common.js`, `relationships.js`, `evidence.js`, `rumors.js`, `factions.js`, `development.js`.
  - **Familiarity Decay**: 30-day exponential familiarity decay after a 7-day grace period ($\tau = 30\,\text{days} / 2,592,000\,\text{s}$).
  - **Rumor Tree Topology**: Verified against 17 topology invariant cases (13 negative + 4 positive).
  - **Belief Adoption**: Trust-gated adoption from hearsay with confidence scaled by trust.
  - **Non-Hive Factions**: Individual member values, needs, emotions, and beliefs remain independent of faction membership.
  - **Cognition Deliberation**: Extended composite utility with $U_{\text{social}}$ evaluating pro-social vs hostile actions, subordinated to hard moral vetoes.
  - **Dual-Store Projection**: Character development shifts project onto values, baseline needs, or character runtime state dispositions/habits.
- **Pure Replay & Field-Level Parity**:
  - `simulationReducer` in `src/living-world/events/replay.js` handles all Phase 8 social transitions in pure memory with zero SQL queries.
  - `verifySimulationParity` proves 100% field-level parity across all 5 Phase 8 tables + character beliefs with zero drift.
- **REST API (Tri-Tier Routes)**:
  - Mounts 11 Phase 8 endpoints across Tier 1 (Observer: graph, rumors, trees, faction memberships), Tier 2 (Subjective character: relationships, evidence, factions, development, known-rumors), and Tier 3 (Director interventions).

### Phase 9 Implementation Details and Scope Distinction

Phase 9 establishes the dynamic living world layer: environmental profiles, location operational states, world-authored ambient archetypes, multi-tier population classification (Core, Supporting, Ambient), deterministic ephemeral population generation with transient IDs, a dynamic entity promotion pipeline, sensory clarity scoring, and pure in-memory replay across all 14 authoritative tables in SQLite under migration `009_environment_and_population` (`PRAGMA user_version = 9`).

#### 1. Implemented Phase 9 Scope
- **Schema & Migrations (Migration 009)**:
  - `lws_location_environmental_profiles`: Environmental conditions per location (`lighting_level`, `crowd_density`, `noise_level`, `air_quality`, `ambient_capacity`, `last_updated_fictional_time`).
  - `lws_location_operational_states`: Operational statuses (`operational_state`, `accessibility`, `movement_speed_modifier`, `danger_level`, `reason`, `active_since_fictional_time`).
  - `lws_ambient_population_archetypes`: World-level authored templates for ambient generation (`archetype_key`, `name`, `description`, `roles`, `weight`, `location_filter_tags`, `time_filter_buckets`).
  - `lws_simulation_character_tiers`: Character classification (`tier` ['core', 'supporting'], `cognitive_budget` ['full', 'lightweight'], `is_promoted`, `assigned_fictional_time`).
  - `lws_promoted_entities`: Immutable causal promotion ledger (`simulation_character_id`, `source_transient_id`, `source_archetype_key`, `promotion_reason`, `causal_event_id`, `promoted_to_tier`, `promoted_at_fictional_time`).
- **Database Boundary Hardening (Cumulative 85 Triggers)**:
  - Exactly 15 Phase 9 triggers enforcing simulation/location immutability, prohibiting direct physical DELETE across all 5 tables, and enforcing immutable append-only semantics for promoted entity records and operational state history.
- **Indexes (Cumulative 51 Indexes across Phase 4–9 Tables)**:
  - Exactly 10 Phase 9 indexes optimizing location profile/operational state lookups, world-scoped archetype retrieval, simulation character tier lookups, and promoted entity provenance tracking.
- **Environment & Population Modules**:
  - Implemented across 8 modules:
    - `src/living-world/environment/common.js`, `environment.js`, `operational-states.js`
    - `src/living-world/population/common.js`, `archetypes.js`, `ambient-generator.js`, `promotion.js`, `character-tiers.js`
  - **Procedural Ambient Generation**: Seeded pseudo-random generation producing deterministic transient IDs (`amb:{sim}:{loc}:{bucket}:{archetype}:{index}`) without persisting rows in SQLite.
  - **Dynamic Entity Promotion**: 4-stage pipeline verifying transient ID existence, creating authored character rows, committing atomic `CHARACTER_JOIN`, and logging immutable promotion provenance.
  - **Population Tiers & Cognitive Budgeting**: Core tier (full deliberative cognition), Supporting tier (need decay across `energy, nourishment, social, safety, morale`, reactive action arbitration, autonomous goal formation suppressed), and Ambient tier (ephemeral).
  - **Sensory Clarity & Movement**: Clarity score ($0..100$) dynamically derived from lighting, crowd density, noise, and air quality; operational states scale travel speed ($0.1$ to $2.0$).
- **Pure Replay & Field-Level Parity**:
  - `simulationReducer` in `src/living-world/events/replay.js` handles all Phase 9 environment, operational state, character tier, and promotion records in pure memory with zero SQL queries.
  - `verifySimulationParity` proves 100% field-level parity across all 14 authoritative tables.
- **REST API (Tri-Tier Routes)**:
  - Mounts 12 Phase 9 endpoints across Tier 1 (Observer: environment, operational states, ambient population estimate), Tier 2 (Subjective character: perspective environmental sensing, character tier), and Tier 3 (Director: profile overrides, state transitions, archetype management, entity promotion).

#### 2. Future Scope Distinction (Phase 10+)
- **Phase 10 Future Scope**: Prompt, Context, and ST Generation Integration (LLM prompt synthesis, context budgeting, token allocation, narrative generation integration).

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
