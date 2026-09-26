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

## Task routing

### Architecture or repository placement
Read `ARCHITECTURE.md`, `CURRENT_ARCHITECTURE_RECONCILIATION.md`, and `REPOSITORY_STRUCTURE.md`.

### Simulation behavior
Read `DOMAIN_RULES.md`, `SIMULATION_MODEL.md`, and `EVENT_AND_TIME_MODEL.md`.

### Cognition, goals, and decisions
Read `SIMULATION_MODEL.md`, `decisions/ADR-015-character-cognition-and-decision-making.md`, and `PERSISTENCE.md`.

### LLM generation / prompting
Read `PROMPT_AND_CONTEXT.md`, `SILLYTAVERN_INTEGRATION.md`, and `DOMAIN_RULES.md`.

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
