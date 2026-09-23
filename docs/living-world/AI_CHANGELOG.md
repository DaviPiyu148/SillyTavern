# AI Changelog

This file records meaningful AI-agent changes to the LWS system.

## Format

```text
## YYYY-MM-DD — Change title

Status: IMPLEMENTED / VERIFIED / PARTIAL / BLOCKED

### Change
What changed.

### Reason
Why it changed.

### Files/modules
Affected areas.

### Architecture
Boundary or contract impact.

### Tests
Tests/checks and result.

### Notes
Known limitations or implications.
```

---

## 2026-09-23 — Phase 4: Events, Authority, and State Transitions

Status: IMPLEMENTED / VERIFIED

### Change
Implemented the authoritative event ledger, 4-stage authority pipeline, narrative turn savepoint execution model, pure in-memory zero-SQL replay engine, and REST endpoints for Living World Simulator (LWS):

1. Created database migration `004_events_and_authority.js` elevating schema version to `PRAGMA user_version = 4`:
   - Exactly 2 runtime tables: `lws_narrative_turns` and `lws_events`.
   - Exactly 16 SQLite database triggers:
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
   - Exactly 7 database indexes:
     1. `idx_lws_events_sim_seq` (unique on `lws_events(simulation_id, sequence_number)`)
     2. `idx_lws_events_sim_time` (on `lws_events(simulation_id, fictional_time, sequence_number)`)
     3. `idx_lws_events_actor` (on `lws_events(actor_character_id) WHERE actor_character_id IS NOT NULL`)
     4. `idx_lws_events_authored_char` (on `lws_events(authored_character_id) WHERE authored_character_id IS NOT NULL`)
     5. `idx_lws_events_idempotency` (unique on `lws_events(simulation_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
     6. `idx_lws_events_turn` (on `lws_events(turn_id) WHERE turn_id IS NOT NULL`)
     7. `idx_lws_narrative_turns_sim_turn` (unique on `lws_narrative_turns(simulation_id, turn_number)`)
2. Created events and authority domain modules under `src/living-world/events/`:
   - `taxonomy.js`: Closed 29-event taxonomy (23 active Phase 4 events, 6 deferred Phase 5 events, 13 stateful events), deepMerge, and JSON schema payload validators.
   - `authority.js`: 4-stage authority pipeline (Schema, Structural/Provenance, Domain, Authority Decision), enforcing that `system` and `simulation_engine` cannot be forged by external callers and `director` requires admin privileges.
   - `state-transitions.js`: Transition handlers for all 13 stateful events, updating projections in SQLite.
   - `events.js`: Monotonic sequence generation, SHA-256 idempotency fingerprinting, `commitEvent`, `getEventByLwsId`, and `listEvents`.
   - `narrative-turns.js`: Two-transaction savepoint execution (`executeNarrativeTurn`), rollback to savepoint on failure, durable rejected turn persistence with `error_details` (HTTP 422), `getNarrativeTurnByLwsId`, and `listNarrativeTurns`.
   - `replay.js`: Pure in-memory zero-SQL `simulationReducer`, `replaySimulation`, and canonical parity verification (`verifySimulationParity`).
3. Refactored Phase 3 services in `src/living-world/simulations/`:
   - `simulations.js`: `createSimulation`, `updateSimulation`, and `deleteSimulation` refactored to delegate state mutations strictly to `commitEvent` (`SIMULATION_START`, `DIRECTOR_MODIFY_STATE`, `SIMULATION_PAUSE`, `SIMULATION_RESUME`, `SIMULATION_STOP`).
   - `simulation-characters.js`: `addSimulationCharacter`, `updateSimulationCharacter`, and `deleteSimulationCharacter` refactored to delegate strictly to `commitEvent` (`CHARACTER_JOIN`, `MOVE_CHARACTER`, `UPDATE_CHARACTER_ACTIVITY`, `UPDATE_PHYSICAL_CONDITION`, `UPDATE_RUNTIME_STATE`, `DIRECTOR_MODIFY_STATE`, `CHARACTER_LEAVE`).
4. Mounted 7 REST endpoints in `src/endpoints/living-world.js`:
   - `POST /api/living-world/simulations/:simLwsId/turns`
   - `GET /api/living-world/simulations/:simLwsId/turns`
   - `GET /api/living-world/simulations/:simLwsId/turns/:turnLwsId`
   - `POST /api/living-world/simulations/:simLwsId/events`
   - `GET /api/living-world/simulations/:simLwsId/events`
   - `GET /api/living-world/simulations/:simLwsId/events/:eventLwsId`
   - `POST /api/living-world/simulations/:simLwsId/replay-verify`
5. Authored ADR-012 in `docs/living-world/decisions/ADR-012-authoritative-event-ledger-and-state-transitions.md`.

### Reason
Fulfills Phase 4 of the LWS implementation roadmap, establishing the core architectural invariant:
"LLM/User Proposes -> Simulation Engine Decides -> Database Records Reality -> Narrative Presents Reality".

### Files/modules
- `src/living-world/migrations/004_events_and_authority.js`
- `src/living-world/migrations/index.js`
- `src/living-world/errors.js`
- `src/living-world/events/taxonomy.js`
- `src/living-world/events/authority.js`
- `src/living-world/events/state-transitions.js`
- `src/living-world/events/events.js`
- `src/living-world/events/narrative-turns.js`
- `src/living-world/events/replay.js`
- `src/living-world/simulations/simulations.js`
- `src/living-world/simulations/simulation-characters.js`
- `src/living-world/index.js`
- `src/endpoints/living-world.js`
- `tests/living-world/lws-events-db.test.js`
- `tests/living-world/lws-events-authority.test.js`
- `tests/living-world/lws-events-transitions.test.js`
- `tests/living-world/lws-narrative-turns.test.js`
- `tests/living-world/lws-events-replay.test.js`
- `tests/living-world/lws-events-api.test.js`
- `docs/living-world/decisions/ADR-012-authoritative-event-ledger-and-state-transitions.md`
- `docs/living-world/PERSISTENCE.md`
- `docs/living-world/PROJECT_STATE.md`
- `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Enforces append-only immutable event ledger at SQLite engine level.
- Enforces strict 4-stage authority validation. Server blocks unauthenticated provenance claims.
- Decouples narrative turn audit persistence from proposal execution via two-transaction savepoint model.
- Eliminates direct runtime row mutation bypasses in Phase 3 services.
- Proves pure in-memory zero-SQL replay with 100% attribute parity against projected rows.

### Tests
- Full living-world test suite passes: 24 test suites, 183 tests.
- Linters clean on root and tests (`npm run lint`, `npm --prefix tests run lint`).

### Notes
- Phase 5 systems (time advance, scheduled events, routines, travel calculations) remain strictly deferred to Phase 5.

---

## 2026-09-23 — Phase 3: Simulation Runtime and Persistence

Status: IMPLEMENTED / VERIFIED / ACCEPTED

### Change
Implemented the simulation runtime and persistence layer for the Living World Simulator (LWS):

1. Created database migration `003_simulation_runtime.js` elevating schema version to `PRAGMA user_version = 3`:
   - Exactly 2 runtime tables: `lws_simulations` and `lws_simulation_characters`.
   - Exactly 10 SQLite database triggers:
     1. `trg_lws_simulations_world_id_immutable` (BEFORE UPDATE OF world_id ON lws_simulations)
     2. `trg_lws_simulations_scenario_id_immutable` (BEFORE UPDATE OF scenario_id ON lws_simulations)
     3. `trg_lws_simulations_scenario_same_world_insert` (BEFORE INSERT ON lws_simulations)
     4. `trg_lws_simulations_status_transition` (BEFORE UPDATE OF status ON lws_simulations)
     5. `trg_lws_sim_chars_simulation_id_immutable` (BEFORE UPDATE OF simulation_id ON lws_simulation_characters)
     6. `trg_lws_sim_chars_character_id_immutable` (BEFORE UPDATE OF character_id ON lws_simulation_characters)
     7. `trg_lws_sim_chars_authored_snapshot_immutable` (BEFORE UPDATE OF authored_snapshot ON lws_simulation_characters)
     8. `trg_lws_sim_chars_same_world_insert` (BEFORE INSERT ON lws_simulation_characters)
     9. `trg_lws_sim_chars_location_insert` (BEFORE INSERT ON lws_simulation_characters: verifies same-world and blocks soft-deleted location)
     10. `trg_lws_sim_chars_location_update` (BEFORE UPDATE OF current_location_id ON lws_simulation_characters: verifies same-world and blocks newly assigning soft-deleted location while preserving existing references)
   - Exactly 5 database indexes:
     - `idx_lws_simulations_world` on `lws_simulations(world_id) WHERE deleted_at IS NULL`
     - `idx_lws_simulations_name_active` (partial unique index on `lws_simulations(world_id, name COLLATE NOCASE) WHERE deleted_at IS NULL`)
     - `idx_lws_sim_chars_sim` on `lws_simulation_characters(simulation_id) WHERE deleted_at IS NULL`
     - `idx_lws_sim_chars_unique_active` (partial unique index on `lws_simulation_characters(simulation_id, character_id) WHERE deleted_at IS NULL`)
     - `idx_lws_sim_chars_location` on `lws_simulation_characters(current_location_id) WHERE deleted_at IS NULL`
2. Created simulation domain modules under `src/living-world/simulations/`:
   - `common.js`: Semantic calendar date validation (`validateFictionalTimestamp`) validating Gregorian leap years, days in month, and 24h clock bounds; status transition matrix validation; and active world/simulation lookups with soft-delete gating.
   - `simulations.js`: Full simulation lifecycle CRUD, scenario instantiation with atomic roster creation and frozen snapshots, active name uniqueness, status transition enforcement, and soft-deletion (allowed from `active`, `paused`, and `archived`). Simulation soft-deletion sets `deleted_at = isoNow()`; child `lws_simulation_characters` rows remain physically intact in SQLite for audit and replay, while child routes return 404 via parent simulation status gating. `updateSimulation` permits updating `name`, `status`, `settings`, and `extensions`, while rejecting attempts to modify `world_id`, `scenario_id`, or `current_fictional_time` with HTTP 400.
   - `simulation-characters.js`: SimulationCharacter CRUD, runtime state mutations (`current_location_id`, `activity`, `physical_condition`, `runtime_state`), duplicate active character conflict rejection (409), paused/archived mutation protection, soft-deleted location assignment guards, and soft-deletion.
3. Established Hybrid Runtime Identity & Snapshots (ADR-011):
   - Runtime instances maintain independent identities and lineages to authored characters without mutating authored tables.
   - Authored cards are snapshotted immutably into `authored_snapshot` upon instantiation.
4. Expanded REST API transport in `src/endpoints/living-world.js`:
   - Added 10 authenticated endpoints for simulation and simulation character operations:
     - `POST /worlds/:worldLwsId/simulations`
     - `GET /worlds/:worldLwsId/simulations`
     - `GET /simulations/:simLwsId`
     - `PATCH /simulations/:simLwsId`
     - `DELETE /simulations/:simLwsId`
     - `POST /simulations/:simLwsId/characters`
     - `GET /simulations/:simLwsId/characters`
     - `GET /simulations/:simLwsId/characters/:simCharLwsId`
     - `PATCH /simulations/:simLwsId/characters/:simCharLwsId`
     - `DELETE /simulations/:simLwsId/characters/:simCharLwsId`
   - Scoped with deleted-World and deleted-Simulation gating.
5. Automated testing and two-simulation isolation proof:
   - Added 5 new test suites: `lws-simulations-db.test.js`, `lws-simulations.test.js`, `lws-simulation-characters.test.js`, `lws-simulations-isolation.test.js`, and `lws-simulations-api.test.js`.
   - Updated existing test suites to assert `user_version = 3`.
   - Verified that two concurrent simulations in the same world progress independently with different locations, activities, and conditions without state collision, and verified that soft-deleting authored cards does not corrupt running simulations.

### Reason
Fulfill Phase 3 of the LWS roadmap to establish persistent runtime simulations and simulation character instances, strictly separating authored definitions from runtime mutations while providing robust database-level integrity, semantic date validation, and status lifecycle control.

### Files/modules
- Created:
  - `src/living-world/migrations/003_simulation_runtime.js`
  - `src/living-world/simulations/common.js`
  - `src/living-world/simulations/simulations.js`
  - `src/living-world/simulations/simulation-characters.js`
  - `tests/living-world/lws-simulations-db.test.js`
  - `tests/living-world/lws-simulations.test.js`
  - `tests/living-world/lws-simulation-characters.test.js`
  - `tests/living-world/lws-simulations-isolation.test.js`
  - `tests/living-world/lws-simulations-api.test.js`
  - `docs/living-world/decisions/ADR-011-hybrid-simulation-runtime-identity-and-snapshots.md`
- Modified:
  - `src/living-world/migrations/index.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `tests/living-world/fixtures/test-db.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-st-integration.test.js`
  - `tests/living-world/lws-authored-domain.test.js`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/PERSISTENCE.md`
  - `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Strict enforcement of separation between authored definitions (`lws_characters`, `lws_worlds`, `lws_locations`) and runtime simulation state (`lws_simulations`, `lws_simulation_characters`).
- Immutability enforced at database trigger boundary for foreign key lineages, originating scenarios, and frozen authored snapshots.
- Single-point entry and parent soft-delete gating on REST endpoints.

### Tests
- Unit and integration tests passing: 18/18 LWS suites (132/132 tests).
- SillyTavern full test suite passing: 37/37 suites (543/543 tests).
- ESLint checks passing cleanly with 0 errors across root and test directories.

### Notes
- Event ledgers (`lws_events`) and causal tick management (`lws_ticks`) are explicitly reserved for Phase 4. Fictional time progression engine, scheduled routines, and travel engines are reserved for Phase 5.

---

## 2026-09-23 — Phase 2: Authored World and Character Model

Status: IMPLEMENTED / VERIFIED / ACCEPTED

### Change
Implemented the authored world and character model for the Living World Simulator (LWS):

#### Approved Plan Scope
1. Created database migration `002_authored_model.js` elevating schema version to `PRAGMA user_version = 2`:
   - Exactly 9 tables: 7 entity tables (`lws_worlds`, `lws_characters`, `lws_locations`, `lws_factions`, `lws_scenarios`, `lws_world_rules`, `lws_authored_prompt_configs`) + 2 join tables (`lws_character_factions`, `lws_scenario_characters`).
   - Exactly 12 SQLite triggers:
     - 6 `BEFORE UPDATE OF world_id` triggers blocking `world_id` mutations across all child entity tables.
     - 4 cross-world relationship triggers on join tables (`BEFORE INSERT` and `BEFORE UPDATE` on `lws_character_factions` and `lws_scenario_characters`).
     - 2 cross-world starting location triggers on `lws_scenarios` (`BEFORE INSERT` and `BEFORE UPDATE OF starting_location_id`).
2. Created domain service modules under `src/living-world/authored/`:
   - `common.js`: UUID validation, timestamps, payload sanitization, active world parent lookup.
   - `worlds.js`: World lifecycle (create, get, list, update, soft-delete).
   - `characters.js`: Character CRUD with supported mapped ST Character V2 subset (`name`, `description`, `personality`, `scenario_context` mapped from ST `scenario`, `mes_example`, `author_notes`, `system_prompt_override`, `source_version`, `tags`, `extensions`).
   - `locations.js`: Location CRUD.
   - `factions.js`: Faction CRUD and member association management (`addMember`, `removeMember`, `listMembers`), filtering soft-deleted members on read and blocking association with soft-deleted characters.
   - `scenarios.js`: Scenario CRUD, starting location verification, and scenario roster management (`addRosterCharacter`, `removeRosterCharacter`, `listRoster`), filtering soft-deleted characters and blocking association with soft-deleted entities.
   - `world-rules.js`: WorldRule CRUD with integer `sort_order`.
   - `prompt-configs.js`: AuthoredPromptConfig 1:1 per-world management, raising HTTP 409 conflict on duplicate creation attempt.
3. Expanded REST API transport in `src/endpoints/living-world.js`:
   - 40+ REST routes covering all authored entities and relationships under `/api/living-world/worlds/:worldLwsId/*`.
   - Parent world gating: any request under `/api/living-world/worlds/:worldLwsId/*` when the parent world is soft-deleted returns `404 {"error": "World not found"}` while child database rows remain intact.
   - Input validation: invalid UUIDs return 400; missing required fields return 400; unique name collisions return 409; cross-world / soft-deleted entity references return 400 or 404.
4. Comprehensive automated test coverage:
   - Added 8 dedicated unit test suites and 1 end-to-end domain/isolation suite under `tests/living-world/`.
   - Updated existing Phase 1 suites (`lws-db.test.js`, `lws-init.test.js`, `lws-st-integration.test.js`, `lws-api.test.js`) to assert schema version 2 and verified backward/forward migration stability.

#### Implementation Enhancements (Beyond Original Plan)
The implemented Phase 2 includes two capabilities that were not explicitly present in the originally reviewed Phase 2 plan:
- **Enhancement A — Hierarchical Locations**:
  The implemented Location service supports self-referential parent locations (`lws_locations.parent_location_id`), hierarchical authored locations (e.g. World → Region → City → Building → Room), parent-location validation (confirming parent belongs to the same world and is active), and circular-reference detection in domain validation (preventing a location from becoming an ancestor of itself).
- **Enhancement B — Active Name Uniqueness**:
  Migration 002 implements 5 partial unique indexes (`WHERE deleted_at IS NULL` with `COLLATE NOCASE`) in SQLite:
  - `idx_lws_worlds_name_active` on `lws_worlds(name)`
  - `idx_lws_characters_name_active` on `lws_characters(world_id, name)`
  - `idx_lws_locations_name_active` on `lws_locations(world_id, name)`
  - `idx_lws_factions_name_active` on `lws_factions(world_id, name)`
  - `idx_lws_scenarios_name_active` on `lws_scenarios(world_id, name)`
  These enforce case-insensitive uniqueness of active entity names within their world scope (and global scope for active worlds). Because the indexes filter on `deleted_at IS NULL`, soft-deleted entity names can be legitimately reused without conflict.

### Reason
Fulfill Phase 2 roadmap to establish canonical authored world, character, location, faction, scenario, rule, and prompt configuration models in SQLite, strictly separating authored definitions from future runtime simulation state while maintaining compatibility with SillyTavern's Character Card V2 schema.

### Files/modules
- Created:
  - `src/living-world/migrations/002_authored_model.js`
  - `src/living-world/authored/common.js`
  - `src/living-world/authored/worlds.js`
  - `src/living-world/authored/characters.js`
  - `src/living-world/authored/locations.js`
  - `src/living-world/authored/factions.js`
  - `src/living-world/authored/scenarios.js`
  - `src/living-world/authored/world-rules.js`
  - `src/living-world/authored/prompt-configs.js`
  - `tests/living-world/lws-authored-worlds.test.js`
  - `tests/living-world/lws-authored-characters.test.js`
  - `tests/living-world/lws-authored-locations.test.js`
  - `tests/living-world/lws-authored-factions.test.js`
  - `tests/living-world/lws-authored-scenarios.test.js`
  - `tests/living-world/lws-authored-world-rules.test.js`
  - `tests/living-world/lws-authored-prompt-configs.test.js`
  - `tests/living-world/lws-authored-domain.test.js`
  - `tests/living-world/lws-authored-api.test.js`
- Modified:
  - `src/living-world/errors.js`
  - `src/living-world/migrations/index.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-st-integration.test.js`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/AI_CHANGELOG.md`
  - `docs/living-world/PERSISTENCE.md`

### Architecture
- Authored state only: zero runtime simulation state is introduced in Phase 2.
- Data integrity enforced at both database and domain service layers via SQLite triggers and transactions.
- Soft-delete semantics preserve historical authored entity records while hiding them from active API queries.
- Clean isolation between SillyTavern character card storage and LWS SQLite persistent storage.

### Tests
- 32 test suites passed, 499 tests passed across the full test suite (0 failures, 0 regressions).
- LWS-specific unit and integration tests: 88 passing tests across 13 LWS test files.
- Linter verification: root linter 0 errors, tests linter 0 errors.

### Notes
- Distinguishes original approved Phase 2 scope from the two implementation enhancements (hierarchical locations and active name uniqueness).
- Authored models are now ready for Phase 3 (Simulation Runtime and Persistence), which will create runtime simulations referencing these authored definitions. Future Phase 3 scope (`Simulation`, `SimulationCharacter`, runtime locations/activity, needs/inventory) remains completely unstarted.

---

## 2026-09-23 — Phase 1: LWS Host Foundation

Status: VERIFIED

### Change
Established the native Living World Simulator (LWS) subsystem host foundation within the SillyTavern fork:
1. Pinned exact production dependency `better-sqlite3: 12.9.0` (with Node 20–24 verified prebuilds) in `package.json` and `package-lock.json`.
2. Created subsystem backend module `src/living-world/`:
   - `errors.js`: Custom LWS error classes (`LwsError`, `LwsNotInitializedError`, `LwsValidationError`).
   - `migrations/001_initial.js`: Phase 1 metadata schema migration.
   - `migrations/index.js`: Deterministic migration runner using `PRAGMA user_version`.
   - `db.js`: Database lifecycle manager configuring WAL mode and foreign keys, safely closing partially opened handles on initialization errors and isolating persistence under `data/living-world/lws.db`.
   - `index.js`: Subsystem entry point implementing safe degraded failure semantics (non-fatal to SillyTavern).
3. Created endpoint router `src/endpoints/living-world.js` exposing `GET /api/living-world/status` (200 healthy / 503 degraded) and `POST /api/living-world/ping` (200 healthy / 503 degraded).
4. Integrated into host server lifecycle:
   - Registered `/api/living-world` in `src/server-startup.js` inside `setupPrivateEndpoints()`, placed behind ST's `requireLoginMiddleware`.
   - Initialized LWS in `src/server-main.js` during `preSetupTasks()` and hooked cleanup into `exitProcess()`.
5. Created frontend bootstrap module `public/scripts/living-world/index.js` and loaded via `<script type="module">` in `public/index.html`.
6. Created comprehensive automated tests in `tests/living-world/` (fixtures, db, init, api unit, and ST HTTP integration).

### Reason
Fulfill the Phase 1 objective to establish the native LWS subsystem host foundation without creating a second server, second application, or separate UI framework.

### Files/modules
- Created:
  - `src/living-world/errors.js`
  - `src/living-world/migrations/001_initial.js`
  - `src/living-world/migrations/index.js`
  - `src/living-world/db.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `public/scripts/living-world/index.js`
  - `data/living-world/.gitkeep`
  - `tests/living-world/fixtures/test-db.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-st-integration.test.js`
- Modified:
  - `.gitignore`
  - `package.json`
  - `package-lock.json`
  - `src/server-startup.js`
  - `src/server-main.js`
  - `public/index.html`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Established native LWS namespace inside existing SillyTavern fork.
- Transport layer (`src/endpoints/living-world.js`) is thin and contains zero simulation logic.
- Persistence is strictly isolated in SQLite (`data/living-world/lws.db`), separated from SillyTavern chat JSON storage.
- Authentication is inherited from SillyTavern's existing `requireLoginMiddleware` rather than creating a secondary auth system.
- Subsystem failure policy is fail-closed for LWS, non-fatal for SillyTavern.

### Tests
- `tests/living-world/lws-db.test.js`: 7 passed (user_version tracking, migration idempotence, foreign keys pragma, WAL mode verification on file-backed DB, persistence restart durability, ST storage isolation).
- `tests/living-world/lws-init.test.js`: 4 passed (clean startup, directory creation, idempotence, shutdown handle release, controlled initialization failure handling).
- `tests/living-world/lws-api.test.js`: 5 passed (GET status 200, POST ping 200, 404 for unknown subpaths, 503 when degraded, leak prevention for DB paths/stack traces).
- `tests/living-world/lws-st-integration.test.js`: 5 passed (HTTP 403 unauthenticated rejection via ST auth, HTTP 200 authenticated status via setupPrivateEndpoints, HTTP 200 ping, HTTP 404 unknown subpath).
- Entire Jest unit test suite: 23 suites passed, 432 tests passed (including all 411 existing ST tests with 0 regressions).
- Real ST server process execution test (`server.js` spawn): verified real process startup logging `[LWS] Subsystem initialized (schema version 1)`, live HTTP query to `/api/living-world/status` returning HTTP 200 with `{ initialized: true, schemaVersion: 1 }`, and verified `data/living-world/lws.db` on disk.
- Linter verification: `npm run lint` and `npm --prefix tests run lint` completed with 0 errors.
- Prohibited tooling check: No browser automation, Playwright, or DevTools used.

### Notes
- Dependency `better-sqlite3: 12.9.0` was installed with exact pinning; version `12.9.1` does not exist in the npm registry (HTTP 404), so `12.9.0` (which includes precompiled binaries for Node 20 through 24 on win32-x64) was pinned.
- Phase 1 schema contains only the `lws_meta` table. Future domain tables (authored worlds, characters, runtime state) will be added via migrations in subsequent phases.
