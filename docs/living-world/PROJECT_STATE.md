# LWS Project State

## As-of

2026-09-23.

## Host repository

`DaviPiyu148/SillyTavern`, target branch `release`.

## Repository observations

The inspected host contains the standard SillyTavern structure: `src/`, `src/endpoints/`, `public/`, `public/scripts/`, `plugins/`, `data/`, and `tests/`.

As of Phase 1 completion, the native LWS subsystem namespace is established and integrated:
- `src/living-world/` (errors, db, migrations, index)
- `src/endpoints/living-world.js`
- `public/scripts/living-world/`
- `data/living-world/`
- `tests/living-world/`

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
| **Phase 1** | **LWS Host Foundation** | **IMPLEMENTED & VERIFIED** | Unit suite (`tests/living-world/`) passes (21/21 tests); ST full suite passes (432/432 tests); real ST server process lifecycle verified with live HTTP probe; clean shutdown verified; SQLite WAL DB created at `data/living-world/lws.db`. |
| Phase 2 | Authored World and Character Model | DESIGNED | Roadmap defined in `PHASE_DEVELOPMENT_PLAN.md`. Not started. |
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

## Status labels

- DESIGNED — documented but not implemented;
- IMPLEMENTED — code exists;
- VERIFIED — backed by relevant tests/checks;
- PARTIAL — some behavior exists but acceptance is incomplete;
- BLOCKED — cannot proceed without a missing decision/dependency;
- UNKNOWN — not verified from repository evidence.

## Important

Do not infer completion from documentation. Inspect source/tests/runtime evidence.
