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

## 2026-09-23 — Phase 2: Authored World and Character Model

Status: VERIFIED

### Change
Implemented the authored world and character model for the Living World Simulator (LWS):
1. Created database migration `002_authored_model.js` elevating schema version to `PRAGMA user_version = 2`:
   - Exactly 9 tables: 7 entity tables (`lws_worlds`, `lws_characters`, `lws_locations`, `lws_factions`, `lws_scenarios`, `lws_world_rules`, `lws_authored_prompt_configs`) + 2 join tables (`lws_character_factions`, `lws_scenario_characters`).
   - Exactly 12 SQLite triggers:
     - 6 `BEFORE UPDATE OF world_id` triggers blocking `world_id` mutations across all child entity tables.
     - 4 cross-world relationship triggers on join tables (`BEFORE INSERT` and `BEFORE UPDATE` on `lws_character_factions` and `lws_scenario_characters`).
     - 2 cross-world starting location triggers on `lws_scenarios` (`BEFORE INSERT` and `BEFORE UPDATE OF starting_location_id`).
   - 5 partial unique indexes enforcing case-insensitive name uniqueness among active (non-soft-deleted) entities per world.
2. Created domain service modules under `src/living-world/authored/`:
   - `common.js`: UUID validation, timestamps, payload sanitization, active world parent lookup.
   - `worlds.js`: World lifecycle (create, get, list, update, soft-delete).
   - `characters.js`: Character CRUD with supported mapped ST Character V2 subset (`name`, `description`, `personality`, `scenario_context` mapped from ST `scenario`, `mes_example`, `author_notes`, `system_prompt_override`, `source_version`, `tags`, `extensions`).
   - `locations.js`: Location CRUD with hierarchical `parent_location_id` and cycle prevention.
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
- Authored models are now ready for Phase 3 (Simulation Runtime and Persistence), which will create runtime simulations referencing these authored definitions.

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
