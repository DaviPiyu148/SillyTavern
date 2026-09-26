# Phase 13 Planning Specification: Replay, Hardening, Release Readiness, and Long-Run Verification

## Document Status: PLANNING — FROZEN PRE-AUTHORIZATION SPECIFICATION

> [!IMPORTANT]
> **Implementation Authorization Gate:**  
> Implementation of Phase 13 is **NOT** authorized by this planning specification. Explicit user authorization is required before any source code is modified or new test files are created.

- **Target Subsystem:** Living World Simulator (LWS) Native Subsystem  
- **Phase:** Phase 13 — Replay, Hardening, Release Readiness, and Long-Run Verification  
- **Target Repository:** `DaviPiyu148/SillyTavern`, Branch `release`  
- **Prerequisite Baseline:** Phase 12 (Native SillyTavern User Workflow and UI) — IMPLEMENTED, VERIFIED, ACCEPTED (Commit `dbaaf140d`)  
- **Database Schema Version:** `PRAGMA user_version = 9` (Migration `009_environment_and_population.js` applied; physical schema remains frozen; zero migrations in Phase 13)  
- **Prerequisite Test Baseline:** 85/85 LWS test suites (596/596 tests passing), 104/104 full repository test suites (1007/1007 tests passing)  
- **Phase 13 Implementation Status:** PENDING AUTHORIZATION  
- **Phase 13 Verification Status:** PENDING AUTHORIZATION (0 Phase 13 test suites executed prior to authorization; 7 planned suites define the post-authorization verification gate)  

---

## 1. Executive Summary & Objective

Phase 13 is the final milestone in the Living World Simulator roadmap (`PHASE_DEVELOPMENT_PLAN.md`). Its primary objective is to make the complete, multi-phase LWS system (Phases 1–12) dependable, resilient, performant, secure, and release-ready under sustained real-world operation.

Phase 13 unifies, hardens, and validates the entire subsystem across nine core pillars:
1. **End-to-End Multi-Phase Regression:** Proving seamless end-to-end simulation lifecycle execution from authoring and card/manifest import to runtime progression, epistemic perception, cognitive deliberation, dynamic social graphs, population tiers, prompt compilation, savepoint commits, and UI workspace hydration.
2. **Full-Lifecycle Event/Replay Parity:** Validating that the pure in-memory zero-SQL replay engine (`replaySimulation`) achieves 100% field-level parity with zero drift across all 29 event types and 10 domain subsystems over long event sequences ($N \ge 1000$ events).
3. **Migration & Schema Durability:** Validating sequential migration execution ($001 \to 009$), migration idempotency, foreign-key cascade integrity, trigger coverage, and forward compatibility across the authoritative SQLite schema (36 user tables, 106 triggers, 61 user-created indexes).
4. **Persistence Durability & Hot Online Backup:** Verifying SQLite WAL-mode crash consistency, atomic dirty-write rollback under transaction failure, point-in-time hot database backup via `better-sqlite3`'s native online backup API (`sqlite3_backup_*`), and structural database integrity (`PRAGMA integrity_check`).
5. **Security & Boundary Hardening:** Auditing and fuzzing all trust boundaries across all 126 REST endpoints against untrusted prompt injection quarantine, directory traversal, prototype pollution (`__proto__`), invalid UUIDs, malformed JSON, and non-admin provenance escalation.
6. **Failure Recovery & Fault Tolerance:** Validating transactional savepoint rollbacks during narrative generation failures, concurrency/lock contention handling, 404 session recovery (`resetOn404()`), and deterministic error mapping.
7. **Performance & Long-Run Continuity:** Validating multi-character continuity over simulated 14-day and 30-day fictional timelines covering routine arbitration, relationship decay ($\tau = 30$ days), need homeostasis, and ambient population generation without memory leaks or unbounded growth.
8. **Observability & Health Probes:** Exposing administrative diagnostic checks (`GET /api/living-world/diagnostics`), hot backup trigger (`POST /api/living-world/admin/backup`), and public liveness probes (`GET /api/living-world/health`).
9. **Documentation Reconciliation:** Updating all architectural documents, diagrams, and domain manuals to reflect the final release-ready system state.

---

## 2. Scope Distinction: Original Roadmap vs. Implementation-Level Design Enhancements

### 2.1 Original Roadmap Scope (from `PHASE_DEVELOPMENT_PLAN.md`)
- End-to-end phase-level regression suite;
- Event/replay parity across supported simulation state;
- Migration verification from supported prior versions;
- Persistence durability and WAL reliability;
- Security boundary verification and invalid/untrusted input safety;
- Failure recovery and error handling;
- Observability and diagnostic logging;
- Performance checks and resource bounding;
- Long-run continuity scenarios (off-camera progression, need decay, relationship drift);
- Documentation reconciliation;
- Release packaging/backup/export behavior.

### 2.2 Implementation-Level Design Enhancements
- **Enhancement A — Hot Online Database Backup Utility (`backupDatabase`):** Utilizes SQLite's native `sqlite3_backup_*` API via `better-sqlite3` (`.backup()`) to generate point-in-time, uncorrupted backup snapshots of `data/living-world/lws.db` to `data/living-world/backups/lws-backup-<timestamp>.db` with strict pre-resolution filename validation, canonical path containment, and count/age retention management.
- **Enhancement B — Diagnostic Integrity & Inventory Engine (`getSystemDiagnostics`):** Executes administrative SQLite verification (`PRAGMA integrity_check`, `PRAGMA foreign_key_check`), verifies active trigger inventory across all 106 triggers, checks table row counts across all 36 user tables, and validates orphaned entity references.
- **Enhancement C — Lightweight Liveness & Health Probe (`getHealthStatus`):** Provides an unauthenticated HTTP health check endpoint (`GET /api/living-world/health`) returning safe operational metadata (subsystem operational status, schema version, database availability, active simulation lock count, and process memory footprint) with zero exposure of sensitive entity, filesystem, or database data.
- **Enhancement D — Multi-Horizon Simulated Soak Harness:** Executes deterministic, multi-day/multi-week timeline advance scenarios with zero LLM latency overhead, verifying cognitive homeostasis and relationship graph convergence over simulated long-run time horizons.

---

## 3. Non-Goals

- **Zero SQL Schema Migrations:** No `010_hardening.js` or `PRAGMA user_version = 10`. The physical database schema was completed and frozen in Phase 9 (`PRAGMA user_version = 9`). Hardening and diagnostic tools operate strictly against the existing schema.
- **No Browser / JSDOM Automation:** In strict compliance with `AGENTS.md` and repository rules, verification is performed 100% in Node via Jest without browser automation, Playwright, Puppeteer, DevTools, or screenshots.
- **No Standalone Server / Microservice:** LWS remains a native in-process subsystem of SillyTavern.
- **No LLM Generation on Replay:** Replay remains strictly zero-SQL and zero-LLM, reconstructing state entirely from immutable event ledgers.

---

## 4. Architecture & Module Structure

Phase 13 introduces dedicated hardening and diagnostic modules under `src/living-world/hardening/` and extends `src/endpoints/living-world.js` with diagnostic routes:

```text
src/living-world/
├── hardening/
│   ├── backup.js                             # Hot SQLite backup runner with timestamping, pre-resolution validation, and retention management
│   ├── diagnostics.js                        # System integrity runner (PRAGMA integrity_check, foreign_key_check, trigger inventory)
│   └── health.js                             # Operational health probe and memory/lock status builder
tests/living-world/
├── lws-hardening-replay-full-lifecycle.test.js # Full multi-phase replay parity across all 29 event types & 10 domains
├── lws-hardening-migration-durability.test.js  # Step-by-step migration sequence (001->009), idempotency, schema versioning
├── lws-hardening-persistence-backup.test.js    # Atomic hot backup, WAL crash consistency, dirty-write rollbacks, integrity check
├── lws-hardening-security-boundaries.test.js   # Fuzzing 126 REST routes, path traversal, prototype pollution, prompt injection quarantine
├── lws-hardening-failure-recovery.test.js      # Savepoint rollbacks, lock contention, 404 recovery, error mapping
├── lws-hardening-longrun-continuity.test.js    # 14-day / 30-day long-horizon multi-character simulation soak scenarios
└── lws-hardening-diagnostics-health.test.js    # Subsystem health probe, diagnostic metrics, and release audit
```

### Module Responsibilities & Defined Operations:

| Module | Responsibility & Defined Operations | Dependencies |
|---|---|---|
| **`backup.js`** | Creates point-in-time hot database backups via `better-sqlite3` native `.backup()`, strictly confines output to `data/living-world/backups/`, validates raw `destination_filename` prior to path operations, enforces count/age retention limits (`MIN_RETAINED_BACKUPS = 1`), and handles cleanup failures gracefully. | `db.js`, `better-sqlite3`, `node:fs`, `node:path`, `errors.js` |
| **`diagnostics.js`** | Runs `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, inventories all 106 database triggers, counts entity rows across all 36 user tables, and checks for orphaned join records. Restricted to admin context. | `db.js` |
| **`health.js`** | Builds safe real-time subsystem operational metrics: database availability, schema version (`user_version = 9`), simulation lock counts, uptime, and Node memory usage. Strips all filesystem paths and entity metadata for public safety. | `db.js`, `simulations/lock.js` |
| **`endpoints/living-world.js`** | Mounts `GET /health` (public liveness), `GET /diagnostics` (admin-gated integrity audit), and `POST /admin/backup` (admin-gated backup trigger), expanding the endpoint inventory to 126 routes. | `hardening/backup.js`, `hardening/diagnostics.js`, `hardening/health.js` |

---

## 5. Contract Specifications & Reconciled Invariants

### 5.1 Backup Retention Policy & Cleanup
- **Count & Age Rules:**
  - `MAX_BACKUP_COUNT`: Maximum number of backups retained in `data/living-world/backups/` (default: 10, minimum: 1).
  - `MAX_BACKUP_AGE_DAYS`: Maximum age of backups retained in days (default: 30 days).
  - `MIN_RETAINED_BACKUPS`: Fixed safety invariant with value `1` (unconditionally preserving at least 1 newest backup regardless of retention age rules).
- **Rotation Lifecycle & Cleanup:**
  - Retention cleanup is executed immediately after a new backup successfully finishes writing and passes validation.
  - Rotation evaluates only files matching the backup filename pattern within the designated directory.
  - Pruning order deletes the oldest backup files first (sorted by filename ISO timestamp / file modification time).
  - If a file deletion fails during cleanup (e.g., `EBUSY`, permission lock), the error is logged as a non-fatal warning; the primary backup operation reports success.
- **Protection of Current & Active Assets:**
  - The newly created backup file is explicitly exempted from pruning during the rotation pass that created it.
  - The active live database file (`lws.db`), WAL journal (`lws.db-wal`), and shared memory (`lws.db-shm`) are strictly protected and never targeted for rotation.

### 5.2 Backup Destination Security & Path Hardening
- **Pre-Resolution Validation of Raw Input:**
  - The raw `destination_filename` value from the request body is inspected immediately before any filesystem resolution or path construction.
  - Any input containing URL-encoded path separators or traversal representations (`%2f`, `%5c`, `%2F`, `%5C`, `%2e%2e`, `%2E%2E`), path separators (`/`, `\`), Windows drive prefixes (e.g. `C:`, `D:`), relative directory tokens (`..`, `.`), or null bytes (`\0`) is rejected prior to normalization.
- **Strict Regex Validation:**
  - If provided by the client, the raw `destination_filename` must match the strict regex: `^[a-zA-Z0-9_\-\.]+\.db$`.
  - Length must be between 4 and 128 characters inclusive.
  - If omitted, the default generated filename is `lws-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`.
- **Canonical Path Containment (Defense-in-Depth):**
  - The target path must resolve strictly within the designated backup directory:
    `path.resolve(BACKUP_DIR, sanitizedFilename).startsWith(path.resolve(BACKUP_DIR) + path.sep)`.
  - Any path traversal attempt or invalid filename fails closed with `LwsValidationError` (`400 Bad Request`).
- **Directory Confinement & Symlink Protection:**
  - Backups are strictly confined to `path.join(dataRoot, 'living-world', 'backups')`.
  - If the designated backup directory or destination file is a symlink or resolves outside `dataRoot/living-world/backups`, the operation fails closed with `400 Bad Request`.

### 5.3 Public Health Boundary & Operational Safety
- **Safe Fields Exposed on Public `GET /api/living-world/health`:**
  - `status`: `"healthy"` | `"degraded"` | `"unavailable"`
  - `schema_version`: number (`9`)
  - `initialized`: boolean (`true` if SQLite database is open and migrated)
  - `uptime_seconds`: number (`Math.floor(process.uptime())`)
  - `active_simulations_count`: number (count of active in-memory simulation locks)
  - `memory_mb`: `{ rss: number, heap_used: number, heap_total: number }` (rounded to integer megabytes)
- **Strict Data Sanitization (Zero Leakage):**
  - Public `/health` MUST NOT expose:
    - Filesystem paths (no `dbPath`, `dataRoot`, directory trees, or OS filenames)
    - Simulation titles, world names, character names, or narrative content
    - Entity IDs, UUIDs, or record counts
    - SQL queries, table names, trigger status, or foreign-key check results
    - Stack traces, internal error messages, or environment tokens
  - All detailed diagnostic data is isolated to `GET /api/living-world/diagnostics` and requires administrative privileges (`req.user?.profile?.admin === true`).

### 5.4 SQLite Online Backup Semantics
- **Engine Mechanics:**
  - Hot backups utilize `better-sqlite3`'s native `.backup(destPath)` API wrapping SQLite's native `sqlite3_backup_*` interface.
  - Shared page cache reading allows continuous incremental copying of database pages to the destination file.
- **Consistency & Concurrency:**
  - SQLite's online backup captures a transactionally consistent point-in-time snapshot.
  - Readers and writers on the source database proceed concurrently; pages modified during the backup pass are automatically refreshed by SQLite.
- **Busy / Timeout Handling:**
  - A timeout (default 30,000ms) is configured. If `SQLITE_BUSY` or `SQLITE_LOCKED` persists beyond the timeout, the backup terminates gracefully, immediately deletes the partially written destination file via `fs.unlinkSync()`, and throws `LwsBackupError` with code `DATABASE_BUSY` (mapped to **`503 Service Unavailable`**).
- **Failure Recovery:**
  - Any unexpected mid-backup internal failure (disk write error, process error) immediately deletes the incomplete backup destination file via `fs.unlinkSync()` and throws an internal error (mapped to **`500 Internal Server Error`**).
- **Success Reporting:**
  - Returns `{ status: "completed", backup_filename: string, backup_path: string, size_bytes: number, timestamp: string }`.

### 5.5 Replay Parity Projections & Normalization
- **Canonical Domain Projections (21 Facets):**
  In `verifySimulationParity(simLwsId)`, the in-memory state projection generated by `replaySimulation` is compared against live SQLite tables across 21 domain facets:
  1. Simulation status & current fictional time
  2. Camera mode & target character/location
  3. Characters (membership, location, activity, physical condition, runtime state)
  4. Character routines
  5. Scheduled events (status, time, triggers)
  6. Knowledge & acquired facts
  7. Episodic memories
  8. Cognitive needs (satisfaction and decay rates across all 6 needs)
  9. Dominant emotions (valence, arousal, intensity)
  10. Character value dimensions
  11. Goals & intentions (status, priority, urgency, progress)
  12. Directional relationships (trust, affection, familiarity, respect, loyalty)
  13. Relationship evidence records count
  14. Social information & rumor propagation trees (topic, claim, depth, veracity, confidence)
  15. Faction memberships (standing, loyalty, role, status)
  16. Character development records count
  17. Belief statements and confidence scores
  18. Character tiers (tier, cognitive budget, promotion flag)
  19. Promoted entity records
  20. Location environments (weather, temp override, lighting override, noise, air quality)
  21. Location operational states (access status, override, crowd density, ambient capacity)
- **Explicit Exclusions:**
  - In-memory lock state and active generation mutexes
  - SQLite auto-increment primary keys (`id` integer primary keys vs `lws_id` business keys)
  - Database row insertion wall-clock timestamps (`created_at`, `updated_at`, `real_timestamp_ms` of SQLite rows)
  - Transient memory cache structures, prompt compilation cache, and token budget calculations
  - Ephemeral client UI state (selection, expanded tabs, scroll position)
- **Fictional Timestamp Normalization & Epsilon Tolerances:**
  - Fictional timestamps are normalized as integer seconds since the simulation epoch across all event payloads and SQLite state records.
  - Entities are matched deterministically by canonical business keys (`*_lws_id`, `fact_key`, `subject_key`, directional `source:target` keys).
  - Floating-point numeric metrics are compared with epsilon tolerance (`|a - b| < 1e-4`).

### 5.6 Crash & Fault Injection Mechanics
- **Deterministic Injected Failure Mechanisms:**
  - **Mechanism A (Mid-Turn Rejection):** Inject an engine/authority validation failure in `executeNarrativeTurn` after recording the turn proposal but prior to transaction commit (simulating invalid state transition, impossible travel, or rule violation).
  - **Mechanism B (Synthetic Database Fault):** Execute operations inside test transactions with synthetic exceptions thrown prior to commit or with simulated locked database handles.
  - **Mechanism C (Interrupted Savepoint Rollback):** Model output parser failure or constraint violation triggering rollback of savepoint `sp_narrative_turn`.
- **Expected Durable State Post-Failure:**
  - **Atomic Dirty-Write Rollback:** 100% rollback of uncommitted entity mutations, character movements, need adjustments, and event logs.
  - **Durable Rejection Logging:** Rejected narrative turns are committed in an independent transaction with `status = 'rejected'` and `rejection_reason` populated for auditability.
  - **Integrity Validation:** Database passes `PRAGMA integrity_check` and `PRAGMA foreign_key_check` with 0 errors immediately after the failure.
  - **Lock Release:** Simulation locks are guaranteed to be released in `finally` blocks, preventing deadlock on subsequent requests.

### 5.7 Security Status Mapping Matrix
All 126 REST endpoints strictly enforce the following deterministic HTTP status code mapping conforming to existing LWS contracts in `src/endpoints/living-world.js`:

| Error / Failure Condition | Error Class / Cause | HTTP Status | Response Format |
|---|---|:---:|---|
| **Malformed JSON / Schema Validation** | `LwsValidationError` | `400 Bad Request` | `{ error: string, code: "LWS_VALIDATION_ERROR", fields: string[] }` |
| **Invalid UUID Path Parameter** | `checkUuidParams` failure | `400 Bad Request` | `{ error: "Invalid <param> UUID format" }` |
| **Path Traversal / Illegal Backup Filename** | `LwsValidationError` | `400 Bad Request` | `{ error: string, code: "INVALID_FILENAME" }` |
| **Entity Not Found** | `LwsNotFoundError` | `404 Not Found` | `{ error: string, code: "LWS_NOT_FOUND" }` |
| **Duplicate Key / Routine Conflict** | `LwsConflictError` | `409 Conflict` | `{ error: string, code: "LWS_CONFLICT", conflicts: object[] }` |
| **Invalid State Transition** | `LwsInvalidStateTransitionError` | `422 Unprocessable Entity` | `{ error: string, code: "INVALID_STATE_TRANSITION", fields: string[] }` |
| **Director / Provenance Violation** | `LwsAuthorityError` (`DIRECTOR_UNAUTHORIZED`, `FORBIDDEN_PROVENANCE`) | `403 Forbidden` | `{ error: string, code: string }` |
| **Paused Simulation Mutation** | `LwsAuthorityError` (`SIMULATION_IS_PAUSED`) | `422 Unprocessable Entity` | `{ error: string, code: "SIMULATION_IS_PAUSED", fields: string[] }` |
| **Rejected Narrative Turn** | `LwsTurnRejectedError` | `422 Unprocessable Entity` | `{ turn_number: number, status: "rejected", rejection_reason: string, ... }` |
| **Unauthenticated Admin Access** | Auth middleware failure (`req.user?.profile?.admin !== true`) | `401 / 403` | `{ error: "Admin authorization required" }` |
| **Database Busy / Timeout on Backup** | `LwsBackupError` (`DATABASE_BUSY`) | `503 Service Unavailable` | `{ error: "Database is currently busy, please retry later" }` |
| **Subsystem Unavailable / Locked** | `!isLwsAvailable()` or database init error | `503 Service Unavailable` | `{ error: "Living World subsystem is unavailable" }` |
| **Unexpected Backup / Internal Error** | Unexpected exception | `500 Internal Server Error` | `{ error: "Internal error" }` (zero stack/path leak) |

### 5.8 Authoritative Schema Object Inventory (`PRAGMA user_version = 9`)
The authoritative database catalog after running sequential migrations ($001 \to 009$) contains:
- **36 User Tables** (Excluding SQLite system tables `sqlite_%`):
  `lws_ambient_archetypes`, `lws_authored_prompt_configs`, `lws_character_beliefs`, `lws_character_development_records`, `lws_character_emotions`, `lws_character_faction_memberships`, `lws_character_factions`, `lws_character_goals`, `lws_character_intentions`, `lws_character_knowledge`, `lws_character_memories`, `lws_character_needs`, `lws_character_relationships`, `lws_character_values`, `lws_characters`, `lws_event_perceptions`, `lws_events`, `lws_factions`, `lws_location_environments`, `lws_location_operational_states`, `lws_locations`, `lws_meta`, `lws_narrative_turns`, `lws_promoted_entity_records`, `lws_relationship_evidence`, `lws_scenario_characters`, `lws_scenarios`, `lws_scheduled_events`, `lws_simulation_cameras`, `lws_simulation_character_routines`, `lws_simulation_character_tiers`, `lws_simulation_characters`, `lws_simulations`, `lws_social_information`, `lws_world_rules`, `lws_worlds`.
- **106 Triggers** (Active immutability, causal integrity, monotonic sequencing, and same-simulation referential integrity constraints).
- **61 User-Created Indexes** (Excluding SQLite internal `sqlite_autoindex_%` objects; 106 total index catalog objects).

### 5.9 Authoritative REST Endpoint Inventory (126 Endpoints)
The LWS REST API mounted in `src/endpoints/living-world.js` comprises exactly 126 endpoints across all 13 phases (123 pre-Phase 13 routes + 3 Phase 13 routes):
- **Phase 1 (Host Foundation & Status):** 2 endpoints (`GET /status`, `POST /ping`).
- **Phase 2 (Authored World & Character Models):** 39 endpoints (CRUD & management for worlds [5], characters [5], locations [5], factions & memberships [8], world rules [5], scenarios & roster [8], prompt config [3]).
- **Phase 3 (Simulation Runtime & Persistence):** 10 endpoints (Simulations CRUD [5], Simulation Characters CRUD [5]).
- **Phase 4 (Events, Authority & Narrative Turns):** 7 endpoints (Events [3], Narrative Turns [3], Simulation Replay Verify [1]).
- **Phase 5 (Time, Schedules, Routines & Travel):** 8 endpoints (Time advance [1], Scheduled Events lifecycle [5], Routine blocks [2]).
- **Phase 6 (Perception, Knowledge, Memories, Cameras & Perspectives):** 13 endpoints (Perceptions [2], Knowledge [3], Memories [2], Beliefs [2], Cameras [2], Perspectives [2]).
- **Phase 7 (Cognition, Needs, Goals, Intentions, Values, Deliberation):** 9 endpoints (Cognition summary [1], Needs [2], Goals [3], Intentions [1], Values [1], Deliberation [1]).
- **Phase 8 (Social Graphs, Relationships, Rumors, Factions, Development):** 11 endpoints (Social graph [1], Social info / rumors [2], Faction memberships [1], Relationships & evidence [3], Character factions [1], Development records [1], Known rumors [1], Social interventions [1]).
- **Phase 9 (Population Tiers, Ephemeral Ambient, Environment, Operations):** 13 endpoints (Ambient archetypes CRUD [5], Location environment [1], Operational state [1], Ambient population [1], Population tiers [1], Promoted entities [1], Perceived environment [1], Environment interventions [1], Promotions [1]).
- **Phase 10 (Prompt Compilation & Generation):** 2 endpoints (`POST /simulations/:simLwsId/prompt-context/build`, `POST /simulations/:simLwsId/generate`).
- **Phase 11 (Import, Normalization & Manifest Pipeline):** 9 endpoints (Character preview/import [2], WorldInfo preview/import [2], Freeform preview/import [2], Manifest preview/commit [2], Manifest export [1]).
- **Phase 12 (Native SillyTavern User Workflow & Slash Commands):** 0 backend REST endpoints (Client-side native UI subsystem, CSS, templates, state store, and 7 native slash commands).
- **Phase 13 (Observability, Diagnostics & Hardening):** 3 endpoints (`GET /health`, `GET /diagnostics`, `POST /admin/backup`).

Total: Exactly 126 REST endpoints ($2 + 39 + 10 + 7 + 8 + 13 + 9 + 11 + 13 + 2 + 9 + 0 + 3 = 126$).

### 5.10 Authoritative Source Audit Evidence
All numbers, contracts, and matrices specified herein are grounded in direct audit of the following repository sources:
1. **126 REST Endpoints:** Source-audited from `src/endpoints/living-world.js` lines 1–2674 (routes 1 to 123) plus 3 Phase 13 diagnostic routes (`/health`, `/diagnostics`, `/admin/backup`).
2. **36 User Tables:** Source-audited from `src/living-world/migrations/001_initial.js` through `009_environment_and_population.js` via `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`.
3. **106 Triggers:** Source-audited from migrations $001 \to 009$ via `SELECT name FROM sqlite_master WHERE type = 'trigger'`.
4. **61 User Indexes:** Source-audited from migrations $001 \to 009$ via `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'` (106 total index objects in SQLite catalog including `sqlite_autoindex_%`).
5. **HTTP Error Mapping:** Source-audited from `src/endpoints/living-world.js` `handleRouteError` (lines 166–190) and `checkUuidParams` (lines 199–207).
6. **Replay Reducer & Event Coverage:** Source-audited from `src/living-world/events/replay.js` `simulationReducer` (lines 21–558), `verifySimulationParity` (lines 2000–2219), and `src/living-world/events/taxonomy.js` `EVENT_TYPES` (29 event types).

---

## 6. Decision Register

| Decision ID | Topic | Options Considered | Classification | Chosen Resolution & Rationalization | Status |
|---|---|---|---|---|:---:|
| **DEC-1301** | Database Schema Invariant | A: Add migration 010 for diagnostic tables.<br>B: Keep `PRAGMA user_version = 9` and store diagnostics in memory/files. | Schema Boundary | **Option B (PRAGMA user_version = 9):** Physical database schema is frozen. Hardening and diagnostic tools run against v9 schema without migrations. Authoritative catalog: 36 user tables, 106 triggers, 61 user indexes. | **RESOLVED & FROZEN** |
| **DEC-1302** | Hot Backup Mechanism & Retention | A: File copy (`fs.copyFileSync`).<br>B: Native SQLite online backup API (`better-sqlite3` `.backup()`) with retention policy. | Durability & Resilience | **Option B (Native SQLite .backup):** Utilizes `sqlite3_backup_*` for transactionally consistent snapshots, pre-resolution validation, strict filename regex (`^[a-zA-Z0-9_\-\.]+\.db$`), path containment to `data/living-world/backups/`, and count/age retention with `MIN_RETAINED_BACKUPS = 1`. | **RESOLVED & FROZEN** |
| **DEC-1303** | Long-Run Soak Testing Horizon | A: Real-time wall-clock delays.<br>B: Discrete simulated 14-day and 30-day timeline advancement with multi-agent routines and event triggers. | Performance & Testing | **Option B (Discrete Timeline Progression):** Evaluates long-horizon simulated time without blocking test execution, validating need decay, relationship familiarity decay ($\tau = 30$ days), routine triggers, and memory relevancy. | **RESOLVED & FROZEN** |
| **DEC-1304** | Security Fuzzing Scope | A: Test only standard HTTP routes.<br>B: Comprehensive input fuzzing across all 126 REST endpoints (prototype pollution, path traversal, oversized inputs, SQL injection vectors, and invalid UUID formats). | Security & Hardening | **Option B (Comprehensive Fuzzing):** Audits all 126 endpoints to prove fail-closed rejection (`400 Bad Request`, `403 Forbidden`, `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity`). | **RESOLVED & FROZEN** |
| **DEC-1305** | Diagnostic Endpoint Authorization | A: All diagnostic endpoints unauthenticated.<br>B: Public `/health` for liveness, admin-gated `/diagnostics` and `/admin/backup`. | Security & Auth | **Option B (Tiered Auth):** Liveness probe `/health` is public and sanitized of all entity/system metadata; administrative diagnostics and backups require admin context (`req.user?.profile?.admin === true`). | **RESOLVED & FROZEN** |
| **DEC-1306** | Verification Strategy | A: Browser automation with Playwright.<br>B: Non-browser automated Node Jest suites and Express integration. | Repository Compliance | **Option B (Strict Non-Browser Node Jest):** In strict accordance with `AGENTS.md` browser verification prohibition. | **RESOLVED & FROZEN** |

---

## 7. Authoritative REST API Extensions for Phase 13

| Method | Endpoint Route | Access Scope | Request Payload / Parameters | Success Response | Error Codes |
|---|---|---|---|---|---|
| **GET** | `/api/living-world/health` | Public / Liveness | None | `200 OK`<br>`{ status: "healthy", schema_version: 9, initialized: true, uptime_seconds: ..., memory_mb: {...} }` | `503 Unavailable` |
| **GET** | `/api/living-world/diagnostics` | Admin Only | None | `200 OK`<br>`{ integrity_ok: true, foreign_keys_ok: true, triggers_active: 106, tables: {...}, orphan_checks: {...} }` | `401 Unauthorized`<br>`403 Forbidden`<br>`503 Unavailable` |
| **POST** | `/api/living-world/admin/backup` | Admin Only | `{ destination_filename?: "..." }` | `200 OK`<br>`{ status: "completed", backup_filename: "...", backup_path: "...", size_bytes: ..., timestamp: "..." }` | `400 Validation Error`<br>`401 Unauthorized`<br>`403 Forbidden`<br>`500 Internal Error`<br>`503 Busy Timeout` |

---

## 8. Non-Browser Automated Verification Gate (Planned Phase 13 Test Suites)

Phase 13 post-authorization verification is defined by 7 dedicated test suites:

### 1. `lws-hardening-replay-full-lifecycle.test.js`
- Proves pure zero-SQL in-memory replay (`replaySimulation`) across all 29 event types.
- Verifies 100% field-level parity with live SQLite state across all 21 domain facets.
- Tests long-sequence replay ($N \ge 1000$ events) with travel, routine switches, relationship updates, and dynamic ambient entity promotions.

### 2. `lws-hardening-migration-durability.test.js`
- Proves clean sequential migration execution from version 0 to 9 (`001_initial` through `009_environment_and_population`).
- Verifies migration idempotency (re-running `runMigrations()` on existing v9 DB produces 0 errors and preserves `user_version = 9`).
- Verifies that all 36 user tables, 106 triggers, and 61 user indexes are correctly created with exact constraints.

### 3. `lws-hardening-persistence-backup.test.js`
- Verifies point-in-time hot online database backup (`backupDatabase`) while transactions are executing.
- Verifies backup retention rotation (`MAX_BACKUP_COUNT = 10`, `MAX_BACKUP_AGE_DAYS = 30`, `MIN_RETAINED_BACKUPS = 1`), pre-resolution filename validation, and path traversal rejection.
- Verifies SQLite WAL crash consistency and dirty-write atomic rollback on simulated database failures.
- Executes `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on live and backed-up databases.

### 4. `lws-hardening-security-boundaries.test.js`
- Fuzzes all 126 REST endpoints with malformed JSON, prototype pollution payloads (`__proto__`, `constructor.prototype`), path traversal strings (`../../etc/passwd`), and invalid UUIDs.
- Verifies prompt injection quarantine: raw untrusted text in character cards or narrative turns cannot bypass simulation authority or redefine engine rules.
- Verifies epistemic isolation under stress: subjective perspectives strictly fail closed and never leak off-camera hidden state.

### 5. `lws-hardening-failure-recovery.test.js`
- Verifies 2-transaction savepoint rollbacks during narrative generation failures (`executeNarrativeTurn`).
- Verifies simulation lock contention handling and timeout recovery (`lws_simulations_lock`).
- Verifies UI state resilience and recovery from missing or soft-deleted simulation entities (`resetOn404()`).

### 6. `lws-hardening-longrun-continuity.test.js`
- Executes simulated 14-day and 30-day long-horizon timeline progressions with multiple autonomous characters.
- Verifies cognitive need homeostasis and hyperbolic emotion decay over weeks of fictional time.
- Verifies asymmetric relationship familiarity decay ($\tau = 30$ days) and rumor transmission depth bounds ($d \le 5$).

### 7. `lws-hardening-diagnostics-health.test.js`
- Verifies `GET /api/living-world/health` liveness probe and verifies zero leakage of sensitive paths or entity metadata.
- Verifies `GET /api/living-world/diagnostics` administrative integrity inspection, trigger validation, and table row counts.
- Verifies `POST /api/living-world/admin/backup` admin-gated backup execution.

---

## 9. Measurable Phase 13 Acceptance Criteria

Phase 13 will be accepted only when all of the following criteria are proven with automated test evidence:

- [ ] **AC-1 (Full Lifecycle Replay Parity & Event Sourcing):** In-memory zero-SQL replay (`replaySimulation`) successfully processes all 29 event types across all 10 domain subsystems, achieving 100% field-level parity with live SQLite state across 21 domain facets over long event sequences ($N \ge 1000$ events) with fictional timestamp normalization and epsilon tolerance. *(Responsible Suite: `lws-hardening-replay-full-lifecycle.test.js`)*
- [ ] **AC-2 (Migration Durability & Schema Integrity):** Migrations $001 \to 009$ execute cleanly and sequentially from an empty database to `PRAGMA user_version = 9`, establishing all 36 user tables, 106 triggers, and 61 user indexes. Re-running migrations is completely idempotent with zero data loss or schema mutation. *(Responsible Suite: `lws-hardening-migration-durability.test.js`)*
- [ ] **AC-3 (Persistence Durability, Crash Consistency & Hot Online Backup):** SQLite WAL mode ensures crash consistency. Atomic dirty-write rollbacks are proven under transaction failure. Hot database backups (`backupDatabase`) produce valid point-in-time database snapshots passing `PRAGMA integrity_check` and `PRAGMA foreign_key_check` with retention management (`MIN_RETAINED_BACKUPS = 1`) and pre-resolution path traversal rejection. *(Responsible Suite: `lws-hardening-persistence-backup.test.js`)*
- [ ] **AC-4 (Security Hardening, Untrusted Input Quarantine & Epistemic Fail-Closed):** All 126 REST endpoints reject malformed inputs, prototype pollution, path traversal, and unauthorized provenance assertions with fail-closed HTTP error codes. Prompt contexts strictly quarantine untrusted content and maintain epistemic isolation under stress. *(Responsible Suite: `lws-hardening-security-boundaries.test.js`)*
- [ ] **AC-5 (Fault Tolerance, Savepoint Rollbacks & Lock Contention):** Narrative generation failures trigger atomic savepoint rollbacks with durable rejected-turn records. Simulation lock contention resolves cleanly without process deadlock. Corrupted/missing simulation sessions recover via `resetOn404()`. *(Responsible Suite: `lws-hardening-failure-recovery.test.js`)*
- [ ] **AC-6 (Long-Run Continuity, Observability & Baseline Preservation):** Simulated 14-day and 30-day timeline continuity scenarios maintain cognitive homeostasis and relationship dynamics. Health and diagnostic endpoints (`/health`, `/diagnostics`, `/admin/backup`) operate accurately. All 85 baseline LWS test suites + 7 Phase 13 suites pass (92 total LWS suites), and all 111 repository test suites pass with zero regressions. *(Responsible Suites: `lws-hardening-longrun-continuity.test.js`, `lws-hardening-diagnostics-health.test.js`)*

---

## 10. Boundaries & Governance

- **Always:**
  - Preserve `PRAGMA user_version = 9` (zero schema migrations).
  - Enforce One Authoritative Path for state mutations.
  - Run tests in Node Jest environment (`tests/jest.config.json`).
  - Maintain 100% baseline regression pass rate.
- **Ask First:**
  - Any alteration to SQLite physical schema tables or trigger definitions.
  - Any addition of external npm dependencies.
- **Never:**
  - Introduce browser automation, Playwright, Puppeteer, DevTools, or screenshots.
  - Introduce an LLM call or SQLite mutation into in-memory replay.
  - Bypass server-enforced event provenance or authority validation.
