# LWS Project State

## As-of

2026-09-23.

## Host repository

`DaviPiyu148/SillyTavern`, target branch `release`.

## Repository observations

The inspected host contains the standard SillyTavern structure: `src/`, `src/endpoints/`, `public/`, `public/scripts/`, `plugins/`, `data/`, and `tests/`.

As of Phase 2 completion, the native LWS subsystem namespace and authored domain models are established and integrated:
- `src/living-world/` (errors, db, migrations, authored domain services, index)
- `src/living-world/authored/` (worlds, characters, locations, factions, scenarios, world-rules, prompt-configs, common)
- `src/endpoints/living-world.js` (status, ping, and complete authored REST endpoints)
- `public/scripts/living-world/`
- `data/living-world/`
- `tests/living-world/` (comprehensive suites covering DB, migrations, authored services, cross-world integrity triggers, immutability, and REST endpoints)

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
| Phase 3 | Simulation Runtime and Persistence | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 4 | Events, Authority, and State Transitions | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
| Phase 5 | Fictional Time, Schedules, Routines, and Travel | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
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

#### 3. Future Scope Distinction (Phase 3+)
- **Phase 3 Future Scope**: Simulation instances (`Simulation`), runtime characters (`SimulationCharacter`), runtime location assignments/activity, physical condition, needs/inventory, simulation isolation, and mutable runtime state machines. Zero mutable runtime simulation state is implemented in Phase 2.

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
