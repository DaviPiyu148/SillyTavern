# LWS Documentation Index

## Entry points

| Document | Use it for |
|---|---|
| `/AGENTS.md` | First-read repository-level agent rules and navigation |
| `PROJECT_STATE.md` | What is actually implemented right now |
| `ARCHITECTURE.md` | Current system architecture and boundaries |
| `CURRENT_ARCHITECTURE_RECONCILIATION.md` | Old ADR/reference decisions vs current SillyTavern-hosted architecture |
| `DOMAIN_RULES.md` | Non-negotiable simulation invariants |
| `SIMULATION_MODEL.md` | World, character, state, cognition, population, and observation model |
| `EVENT_AND_TIME_MODEL.md` | Events, time advance, schedules, routines, travel, causal ordering, replay |
| `PROMPT_AND_CONTEXT.md` | What is sent to the LLM and how knowledge/instructions are bounded |
| `SILLYTAVERN_INTEGRATION.md` | Integration with the actual SillyTavern fork |
| `PERSISTENCE.md` | SQLite, event history, projections, durability, replay |
| `IMPORT_AND_NORMALIZATION.md` | Importing ST cards/world info/freeform content |
| `PHASE_11_PLAN.md` | Phase 11 planning artifact for Import, Normalization, and Authoring Workflow |
| `PHASE_12_PLAN.md` | Phase 12 planning artifact for Native SillyTavern User Workflow and UI |
| `PHASE_13_PLAN.md` | Phase 13 planning artifact for Replay, Hardening, Release Readiness, and Long-Run Verification |
| `SECURITY.md` | Trust boundaries and security invariants |
| `REPOSITORY_STRUCTURE.md` | Where LWS code/data/tests/docs belong |
| `DEVELOPMENT_WORKFLOW.md` | How an AI agent should implement changes |
| `PLANNING.md` | Planning format and decision discipline |
| `PHASE_DEVELOPMENT_PLAN.md` | Fixed phase roadmap and phase-level completion rules |
| `TESTING.md` | Behavior-focused testing and verification |
| `DEBUGGING.md` | Root-cause debugging method |
| `TOOLING_AND_SKILLS.md` | Skills/tools selection |
| `AI_CHANGELOG.md` | AI-agent implementation history |

## Decisions

`decisions/` contains the accepted ADRs supplied for LWS. They preserve decision rationale; current implementation guidance is reconciled in the documents above.
- `ADR-001` through `ADR-010`: Foundation and core architecture principles.
- `ADR-011`: Hybrid Simulation Runtime Identity and Snapshots (Phase 3).
- `ADR-012`: Authoritative Event Ledger and State Transitions (Phase 4).
- `ADR-013`: Temporal Progression, Schedules, Routines, and Travel (Phase 5).
- `ADR-014`: Perception, Knowledge, Memory, and Observation (Phase 6).
- `ADR-015`: Character Cognition, Goals, Values, Emotions, and Decision Making (Phase 7).
- `ADR-016`: Social Systems, Dynamic Relationships, Rumors, Factions, and Character Development (Phase 8).
- `ADR-017`: Living World, Population Tiers, Environmental Dynamics, Operational States, and Emergence (Phase 9).
- `ADR-018`: Prompt, Context, Perspective Isolation, and SillyTavern Generation Integration (Phase 10).
- `ADR-019`: Import, Normalization, Provenance, and Authored Creation Workflow (Phase 11).
- `ADR-020`: Native SillyTavern User Workflow and UI Architecture (Phase 12).
- `ADR-021`: Replay, Hardening, Release Readiness, and Long-Run Verification (Phase 13).

## Task routing

### Architecture or repository placement
Read `ARCHITECTURE.md`, `CURRENT_ARCHITECTURE_RECONCILIATION.md`, and `REPOSITORY_STRUCTURE.md`.

### Simulation behavior
Read `DOMAIN_RULES.md`, `SIMULATION_MODEL.md`, and `EVENT_AND_TIME_MODEL.md`.

### Cognition, goals, and decisions
Read `SIMULATION_MODEL.md`, `decisions/ADR-015-character-cognition-and-decision-making.md`, and `PERSISTENCE.md`.

### Social systems, rumors, factions, and character development
Read `SIMULATION_MODEL.md`, `decisions/ADR-016-social-systems-and-character-development.md`, `SECURITY.md`, and `PERSISTENCE.md`.

### Population tiers, ambient crowds, environment, and operational states
Read `SIMULATION_MODEL.md`, `decisions/ADR-017-living-world-population-environment-and-emergence.md`, `SECURITY.md`, and `PERSISTENCE.md`.

### LLM generation / prompting
Read `PROMPT_AND_CONTEXT.md`, `decisions/ADR-018-prompt-context-and-generation-integration.md`, `SILLYTAVERN_INTEGRATION.md`, and `DOMAIN_RULES.md`.

### Persistence / replay
Read `PERSISTENCE.md` and `EVENT_AND_TIME_MODEL.md`.

### Existing ST character/world import
Read `IMPORT_AND_NORMALIZATION.md` and `SILLYTAVERN_INTEGRATION.md`.

### Frontend/UI
Read `SILLYTAVERN_INTEGRATION.md`, `REPOSITORY_STRUCTURE.md`, `TOOLING_AND_SKILLS.md`, and `TESTING.md`.

### Bug fixing
Read `DEBUGGING.md`, the domain-specific document for the affected behavior, and `TESTING.md`.

### Planning an implementation
Read `PROJECT_STATE.md`, relevant domain/architecture documents, `PLANNING.md`, and `DEVELOPMENT_WORKFLOW.md`.
