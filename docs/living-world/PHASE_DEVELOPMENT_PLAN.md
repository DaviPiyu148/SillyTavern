# LWS Predetermined Phase Development Plan

## Purpose

LWS is developed in **predetermined phases**. A phase is the unit of development and delivery.

The agent must not replace the phase plan with a sequence of independently delivered “subtasks”, “slices”, “mini-phases”, or feature fragments.

A phase is considered complete only when its entire phase scope, acceptance criteria, tests, and documentation requirements are satisfied.

## Phase governance

### Fixed phase sequence

The phases below are the planned development sequence for the current LWS architecture.

They are not suggestions. Do not invent a new phase merely because a convenient implementation boundary appears.

A phase may be revised only when:
- an architectural decision changes the product;
- a dependency makes the planned phase impossible;
- repository evidence shows that a phase has already been fully implemented;
- the user explicitly changes the roadmap.

Any such change must be documented in `AI_CHANGELOG.md` and, when architectural, in an ADR.

### Phase completion rule

The active phase must be developed as one coherent phase.

During a phase, internal engineering organization is allowed, but completion is binary:

```text
NOT STARTED → IN PROGRESS → COMPLETE
                         ↘ BLOCKED
```

Do not mark a phase complete while meaningful acceptance criteria remain unimplemented or unverified.

Do not begin the next planned phase merely because one feature inside the current phase works.

### No slice-based delivery

Do not use these as substitutes for the phase model:

- “vertical slice 1/2/3”;
- “subtask 1/2/3” as independent delivery units;
- “MVP of the phase” followed by “finish phase later”;
- silently moving unfinished phase scope into a later phase.

The phase itself is the delivery unit.

### Verification

Verification is performed at phase level. The phase is complete only after:
- implementation is complete across its defined scope;
- phase-level behavior is tested;
- affected integration paths are tested without browser verification;
- regressions are checked;
- documentation/status are updated.

## Predetermined phases

### Phase 1 — LWS Host Foundation

**Goal:** Establish the native LWS subsystem inside the SillyTavern fork without creating a second application.

Scope:
- LWS repository namespace;
- backend application boundary;
- LWS API boundary;
- LWS frontend namespace;
- SQLite ownership/location;
- startup/lifecycle registration;
- basic authenticated request boundary;
- core integration adapter boundary;
- test namespace;
- foundational logging/error handling.

Acceptance:
- LWS can initialize inside the existing ST process;
- normal SillyTavern operation remains intact;
- LWS has isolated namespace/persistence boundaries;
- no second server/frontend framework is introduced;
- no browser verification is used.

### Phase 2 — Authored World and Character Model

**Goal:** Establish reusable authored data.

Scope:
- World;
- Character;
- Location;
- Faction;
- Scenario;
- world rules;
- authored prompt/style configuration;
- version/identity rules needed for authored data.

Acceptance:
- a world can be created/persisted;
- authored characters can be created/persisted;
- existing ST character data can be represented as an authored LWS character without coupling runtime state to the source card;
- authored entities are reusable across simulations.

### Phase 3 — Simulation Runtime and Persistence

**Goal:** Establish simulation-scoped mutable state and durable storage.

Scope:
- Simulation;
- SimulationCharacter;
- runtime location/activity/state;
- needs/resources/inventory where defined;
- simulation isolation;
- SQLite migrations;
- repository/data-access boundaries.

Acceptance:
- a world can create an independent simulation;
- the same authored character can exist in multiple simulations without shared mutable runtime state;
- runtime state survives restart;
- authoritative state is not stored in ST chat metadata or prompt text.

### Phase 4 — Events, Authority, and State Transitions

**Goal:** Establish authoritative event-driven state mutation.

Scope:
- SimulationEvent;
- event schemas;
- proposal parsing;
- schema/domain validation;
- transactional state transitions;
- NarrativeTurn audit record;
- causal references;
- deterministic event identity/ordering rules;
- partial/rejected proposal semantics.

Acceptance:
- LLM output cannot directly mutate authoritative state;
- valid proposals become committed events;
- invalid proposals are rejected safely;
- narrative is downstream of committed state;
- event history is inspectable.

### Phase 5 — Fictional Time, Schedules, Routines, and Travel

**Goal:** Establish world progression.

Scope:
- fictional clock;
- `TIME_ADVANCE`;
- scheduled events;
- recurring routines;
- activity arbitration;
- deterministic world-life processing;
- temporal travel;
- route/distance/transport/time consumption;
- deterministic intra-batch causal ordering;
- replay behavior for this phase.

Acceptance:
- requested time advances progress the world without requiring unnecessary LLM calls;
- routines and schedules execute deterministically;
- travel consumes fictional time;
- chronological ordering remains valid;
- replay reconstructs the supported state without LLM calls.

### Phase 6 — Perception, Knowledge, Memory, and Observation

**Goal:** Establish the information boundaries that make characters non-omniscient.

Scope:
- spatial/visibility checks required for perception;
- `perceived_by` history;
- knowledge acquisition;
- communication/evidence/record channels;
- beliefs and suspicions;
- persistent memories;
- relevance-bounded memory retrieval;
- Observer/camera separation.

Acceptance:
- characters do not receive hidden information they have not acquired;
- Observer inspection can be distinct from character cognition;
- memory survives many generations;
- historical perception is preserved for replay;
- camera focus does not limit simulation existence.

### Phase 7 — Character Cognition and Decision Making

**Goal:** Give characters autonomous, persistent decision behavior.

Scope:
- needs/goals/values;
- current intentions;
- decision proposals;
- emotion;
- personality influence;
- beliefs + memories + relationships + environment;
- irrationality/misunderstanding/procrastination/deception behavior;
- deterministic physical/action constraints.

Acceptance:
- characters can make context-dependent decisions;
- decisions are constrained by actual simulation state;
- impossible actions are rejected;
- cognition does not directly commit authoritative state;
- characters can make mistakes without corrupting the simulator.

### Phase 8 — Social Systems and Character Development

**Goal:** Establish persistent social and psychological evolution.

Scope:
- directional relationships;
- trust/affection/familiarity/respect and related derived dimensions;
- causal relationship evidence;
- factions as non-hive social systems;
- social information/rumors;
- character development records;
- persistent disposition/value/goal/habit changes;
- regression and conflicting development.

Acceptance:
- relationship changes have persisted causes/evidence;
- faction members can disagree or act independently;
- rumors are distinguished from truth;
- persistent character change is causally explainable.

### Phase 9 — Living World, Population, Environment, and Emergence

**Goal:** Make locations feel inhabited without simulating an entire city at full detail.

Scope:
- environment state;
- deterministic environmental consequences;
- Core/Supporting/Ambient population tiers;
- contextual NPC generation;
- vehicles/traffic and other ambient entities where relevant;
- promotion of repeated ambient entities;
- location activity.

Acceptance:
- a location can produce plausible contextual entities;
- ambient entities do not require full persistent simulation;
- repeated relevance can promote an entity to persistent state;
- environmental effects update state deterministically when rules are known;
- off-camera characters continue to live.

### Phase 10 — Prompt, Context, and SillyTavern Generation Integration

**Goal:** Connect the simulation to LLM generation without giving the LLM authority.

Scope:
- LWS protected simulation contract;
- dynamic context construction;
- knowledge filtering;
- character/world context selection;
- recent causal event selection;
- memory retrieval;
- Director command context;
- output contracts;
- ST system-prompt compatibility;
- user system prompts as first-class configuration;
- ST generation/provider/streaming integration;
- model response parsing.

Acceptance:
- the model receives only context allowed for the generation;
- custom user system prompts remain usable;
- prompts cannot bypass application authority;
- LWS does not duplicate ST provider infrastructure;
- consequential model output is validated before state mutation;
- generation is reproducible enough to diagnose from recorded prompt/context metadata where policy permits.

### Phase 11 — Import, Normalization, and Authoring Workflow

**Goal:** Make existing SillyTavern/AI-RP content usable in LWS.

Scope:
- Character Card import;
- World Info/lorebook import;
- freeform world/scenario import;
- AI-assisted normalization;
- provenance;
- conflict detection;
- review/confirmation for ambiguous transformations;
- authored world/character creation workflow.

Acceptance:
- existing ST characters can enter LWS without losing source provenance;
- missing information is not silently invented;
- ambiguous normalization is reviewable;
- canonical LWS entities are valid and reusable.

### Phase 12 — Native SillyTavern User Workflow and UI

**Goal:** Provide the complete LWS workflow while retaining SillyTavern's UI/UX language.

Scope:
- entry into Living World mode;
- world selection/creation;
- character selection/creation;
- scenario setup;
- simulation initialization;
- opening greeting;
- state/stat/thought displays;
- follow/observe controls;
- Director commands;
- time advancement controls;
- narrative display;
- persistence/reload workflow;
- settings and configuration surfaces using ST patterns;
- responsive behavior using existing ST conventions.

Acceptance:
- the complete workflow can be exercised through the existing ST UI;
- the UI looks and behaves like SillyTavern rather than a separate application;
- following Dave still allows Charlotte and Tom to continue living;
- state/thoughts/narrative update coherently;
- no browser verification is used; UI code is verified with static/unit/integration/runtime checks available outside browser automation.

### Phase 13 — Replay, Hardening, Release Readiness, and Long-Run Verification

**Goal:** Make the complete LWS system dependable and maintainable.

Scope:
- end-to-end phase-level regression suite;
- event/replay parity;
- migration verification;
- persistence durability;
- security boundary verification;
- failure recovery;
- observability;
- performance checks;
- long-run continuity scenarios;
- documentation reconciliation;
- release packaging/backup/export behavior that belongs to the current release scope.

Acceptance:
- representative long-running simulations maintain continuity;
- replay reproduces supported state;
- migrations work from supported prior versions;
- invalid/untrusted inputs fail safely;
- no critical simulation invariant is known to be violated;
- documentation accurately states what is implemented and verified.

## Phase sequencing rule

The default order is:

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13
```

Do not skip ahead merely because a later feature is interesting.

A later-phase requirement discovered during implementation may be recorded as future work, but the current phase still must meet its own definition of complete.

## Current project status

The phase plan is a roadmap, not evidence of implementation.

Check `PROJECT_STATE.md` and the repository before assigning implementation status to any phase.

## Relationship to previous LWS phase history

The earlier standalone LWS project had a historical phase structure and implementation work. This current document defines the phase sequence for the **SillyTavern-native architecture**.

When porting or reusing prior implementation, map it to these phases only after inspecting the actual code and proving its behavior.

Do not assume that a previously completed phase in the standalone project is automatically complete in the SillyTavern fork.
