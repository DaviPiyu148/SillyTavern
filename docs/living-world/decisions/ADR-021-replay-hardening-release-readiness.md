# ADR-021: Replay, Hardening, Release Readiness, and Long-Run Verification

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 13)

## Context

The Living World Simulator (LWS) has completed Phases 1 through 12, establishing the core domain models, simulation runtime, authoritative event ledger, temporal engine, epistemic perception/knowledge, character cognition/decision-making, social dynamics/development, population tiers/environments, prompt context building, import/normalization workflows, and native SillyTavern UI.

Phase 13 delivers subsystem hardening, hot SQLite online backup, health and diagnostics observability, strict security boundaries, 100% database-to-replay parity across all 29 event types, and long-horizon multi-week simulation continuity verification.

### Core Architectural Invariants Maintained
1. **Native Subsystem Discipline (`AGENTS.md` Rule 1 & 2):** LWS remains a native in-process subsystem of SillyTavern. No separate server, external database, or container is introduced.
2. **One Authoritative Path (`AGENTS.md` Rule 3 & 4):** Authoritative simulation state resides strictly in SQLite (`data/living-world/lws.db`). The LLM and user never mutate state directly. All mutations flow through server-enforced event and authority pipelines.
3. **Pure Zero-SQL & Zero-LLM Replay:** Replaying the chronological event ledger occurs in pure memory via deterministic reducers without database queries or LLM calls.
4. **Epistemic & Spatial Boundary Isolation:** Epistemic isolation between characters is mathematically preserved; subjective perspectives strictly omit non-collocated characters and unperceived facts.
5. **Zero Database Migrations:** Phase 13 introduces zero schema migrations, strictly preserving `PRAGMA user_version = 9`.
6. **Non-Browser Automated Verification Discipline:** In strict conformance with `AGENTS.md`, verification is executed entirely without browser automation or DevTools, using comprehensive Node-based Jest test suites.

---

## Decision

### 1. Hot Online Database Backup & Hardening (`src/living-world/hardening/backup.js`)
- Utilizes `better-sqlite3`'s native `.backup()` API to perform non-blocking hot online backups of the live SQLite database while active transactions execute.
- **Pre-resolution Input Validation:** Validates destination filenames prior to filesystem resolution, strictly rejecting traversal sequences (`..`, `%2e%2e`), separators (`/`, `\`, `%2f`, `%5c`), drive prefixes (`C:`, `D:`), and null bytes (`\0`).
- **Canonical Path Containment:** Resolves all backup files within `data/living-world/backups/`, preventing symlink escapes or unauthorized directory writes.
- **Retention & Rotation Policy:** Rotates timestamped backup files according to a configurable retention policy (`retention_count`, default 10) while strictly enforcing the safety invariant `MIN_RETAINED_BACKUPS = 1` (never deleting the only remaining backup).
- **Live File Protection:** Explicitly prevents overwriting or deleting active database files (`lws.db`, `lws.db-wal`, `lws.db-shm`).
- **Error Mapping:** Maps database busy/lock contention to `LwsBackupError` with code `DATABASE_BUSY` (HTTP 503) and general backup failures to code `BACKUP_FAILED` (HTTP 500).

### 2. Diagnostics & Schema Integrity (`src/living-world/hardening/diagnostics.js`)
- **Database Catalog Audit:** Verifies the complete catalog of exactly 36 user tables, 106 triggers, and 61 user indexes.
- **Integrity Probes:** Executes `PRAGMA integrity_check` and `PRAGMA foreign_key_check` to verify B-tree and foreign key integrity.
- **Referential Orphan Checks:** Performs relational integrity queries detecting dangling entities across all domain tables.
- **Storage Metrics:** Reports database file size, page count, and table row counts.

### 3. Public Health & Observability (`src/living-world/hardening/health.js`)
- **Sanitized Liveness Probe:** Public `GET /health` endpoint exposes high-level operational status (`status: "ok"`, `schema_version: 9`, `uptime_seconds`, `active_simulations_count`, `memory_mb`) without leaking entity details, world names, file paths, or sensitive diagnostics.

### 4. Administrative Authorization & Security Boundaries (`src/endpoints/living-world.js`)
- **Admin-Gated Endpoints:** `GET /diagnostics` and `POST /admin/backup` enforce administrative privileges (`checkAdminAuth`), returning HTTP 401 for unauthenticated callers and HTTP 403 for non-admin accounts.
- **Input Sanitization & Injection Quarantine:** Validates all route parameters for RFC 4122 UUID compliance (`checkUuidParams`), rejects prototype pollution (`__proto__`, `constructor`), and neutralizes prompt injection payloads in narrative turns without simulation authority bypass.

### 5. Deterministic Full-Lifecycle Replay & Long-Horizon Continuity
- **21-Facet Replay Parity:** In-memory reducer achieves exact 100% database-to-replay parity across all 29 event types, verifying characters, routines, scheduled events, cameras, knowledge, memories, beliefs, needs, goals, intentions, values, emotions, relationships, evidence, rumors, faction memberships, development records, tiers, promoted entities, location environments, and operational states.
- **Long-Horizon Timeline Advance:** Verified stable continuity over simulated multi-week spans (14-day timeline advance with 1,209,600s, 30-day asymmetric familiarity decay with $\tau = 30\text{ days}$, and hyperbolic emotion decay with $\tau = 14,400\text{s}$).

---

## Consequences

- The Living World Simulator is hardened, resilient, and fully verified for release readiness.
- The authoritative SQLite database can be backed up online without taking the simulation offline.
- Replay engine determinism is proven across short, medium, and 1000+ event streams with 0 drift.
- Full repository test suite passes at 100% (111 test suites / 1031 tests, with 92 suites / 620 tests dedicated to LWS).
