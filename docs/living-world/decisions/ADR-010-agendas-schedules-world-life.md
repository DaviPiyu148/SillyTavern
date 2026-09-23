# ADR-010: Agendas, Schedules, Intra-Batch Causal DAG Scheduling, and World Life

## Status

Accepted

## Context

In Phase 7, the Living World Simulator introduces character routines, active agendas, scheduled world events, and deterministic continuity during requested time advances (`TIME_ADVANCE`).

Key architectural challenges addressed:
1. **Deterministic Candidate Generation & Ordering:** Multi-event turns and time advances generate batches of consequence events across characters and scheduled events that must be ordered deterministically without random UUID tie-breaking.
2. **Intra-Batch Causal Dependencies & Linear Proposal Chaining:** Staged LLM proposals ($P_0, P_1, \dots, P_n$) and intra-batch consequences (such as movement preceding activity updates) must commit in valid causal order, preserving validated staging order.
3. **Fictional Time Monotonicity:** Ledger sequence commits must strictly guarantee non-decreasing fictional time ($t_i \ge t_{i-1}$) across all events.
4. **Arbitration & Override Governance:** Contending influences (Director overrides, severe conditions, active goals, routines) must resolve through a deterministic 7-tier arbitration hierarchy with Director Override suspension under severe conditions.
5. **Zero-SQL Replay Parity:** Character routines, current activities, and scheduled event states must be 100% reconstructible through event-sourced replay folding without database queries to projection tables.

## Decision

1. **Closed 29-Event Taxonomy & 24 Director Commands:**
   - 20 proposable event types, 4 director/engine management types (`UPDATE_CHARACTER_ROUTINE`, `SCHEDULE_WORLD_EVENT`, `CANCEL_SCHEDULED_EVENT`, `SUPERSEDE_SCHEDULED_EVENT`), and 5 lifecycle types (`TRIGGER_SCHEDULED_EVENT`, `SIMULATION_START`, `SIMULATION_PAUSE`, `SIMULATION_RESUME`, `SIMULATION_STOP`).
   - 24 `DirectorCommandRequest` discriminated union variants.

2. **Source-Dependent Tick Semantics:**
   - Direct Director commands commit at `simulation.current_tick` ($t = t_{current}$).
   - `TIME_ADVANCE` batches advance simulation time to $t_{target} = t_{start} + \Delta t$ and commit sub-events at $t_{current} \le t \le t_{target}$, incrementing `current_tick` by 1 upon batch completion.

3. **3-Pass Deterministic Candidate Pipeline:**
   - Pass 1: Scheduled event triggers matching or preceding target time ($T_{target}$), sorted canonically by `(scheduled_fictional_time, created_at_tick, event_title, scheduled_event_id)`.
   - Pass 2: Canonical character evaluation sorted by `(simulation_character_id)`. Evaluates 7-tier arbitration hierarchy, BFS topological pathfinding for spatial transitions, and candidate activity updates.
   - Pass 3: Sealing `TIME_ADVANCE` candidate.

4. **Intra-Batch Causal DAG & Kahn Topological Scheduling:**
   - Linear proposal staging edges: for multi-event LLM turns, consecutive proposals receive $P_i \to P_{i+1}$ DAG edges to strictly preserve validated staging order.
   - Intra-batch consequence edges: `MOVE_CHARACTER(C) -> UPDATE_CHARACTER_ACTIVITY(C)`, and all sub-events $\to$ `TIME_ADVANCE`.
   - Kahn topological sort tie-breaks ReadyQueue using 5-tuple SortKey:
     `(fictional_time, temporal_order_class, causal_tier, batch_sequence_index, deterministic_entity_key)`.
   - Replay strictly follows immutable committed `sequence_number`.

5. **7-Tier Activity Arbitration Hierarchy:**
   - `DIRECTOR_OVERRIDE` (active) > `INTERRUPTED` (severe condition) > `GOAL_PURSUIT` (active high-priority goal) > `TRAVEL` (active BFS travel) > `ROUTINE` (matching routine block) > `IDLE` (fallback).
   - A severe condition (`severity == "SEVERE"`) suspends an active Director Override; the override resumes automatically if remaining ticks exist upon condition resolution.

6. **Scheduled Event Lifecycle, Participant Resolution & Supersession:**
   - 4-state lifecycle: `PENDING` $\to$ `TRIGGERED`, `CANCELLED`, or `SUPERSEDED` (terminal and immutable).
   - Authored vs Runtime Participants: Authored models reference `Character.id` and `Location.id`. Both `(simulation_id, character_id)` and `(world_version_id, location_id)` are guaranteed strictly unique by database constraints, ensuring 100% deterministic materialization without incidental DB ordering dependencies. Missing authored references raise domain error `UNRESOLVED_AUTHORED_ENTITY` and duplicate participants raise `DUPLICATE_PARTICIPANT` (both mapped to HTTP 422 at the REST layer).
   - Derived-Only `is_global`: `is_global` is a derived domain property (`target_location_version_id is None`), eliminating denormalized column drift.
   - Referential Integrity: `target_location_version_id` uses `ON DELETE RESTRICT` against immutable `LocationVersion` records, preventing dangling or mutated rows.
   - Canonical FictionalTimestamp: `YYYY-MM-DDTHH:MM:SSZ` where `Z` is a lexical format delimiter (no real-world Earth timezone semantics).
   - Bidirectional supersession: Stored via two persisted foreign key columns `supersedes_event_id` and `superseded_by_event_id` on `simulation_scheduled_events`. Scheduling with `supersedes_event_id` atomically marks the predecessor `SUPERSEDED` with `superseded_by_event_id = new_id` and creates the successor as `PENDING` with `supersedes_event_id = target_id`.
   - Supersession Provenance: Ledger-only provenance; the `SCHEDULE_WORLD_EVENT` ledger entry establishes the provenance of the transition, and `superseded_by_event_id` links to the successor projection entity without requiring a redundant `supersession_event_id` column.
   - Cross-Field Invariant Matrix: Enforces strict nullability rules for `trigger_event_id`, `cancel_event_id`, timestamps, and supersession links across all four lifecycle states.

7. **Zero-SQL Event-Sourced Replay Parity:**
   - The in-memory reducer reconstructs all character routines, activities, and scheduled event projections by folding `SimulationEvent` records alone, with zero SQL queries to projection tables.

## Consequences

- Time advance execution deterministically moves characters, triggers scheduled events, and updates activities without LLM calls.
- Staged LLM proposals never reverse order during batch commit.
- Replay parity is mathematically preserved with monotonic timestamps and complete state reproducibility.
