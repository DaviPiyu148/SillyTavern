# ADR-013: Temporal Progression, Schedules, Routines, and Travel

## Status

Accepted

## Context

In Phase 4, Living World Simulator (LWS) established an authoritative event ledger (`lws_events`), four-stage authority evaluation, narrative turns auditing, and pure in-memory zero-SQL replay. However, fictional time remained static, characters lacked autonomous routines, travel was instantaneous without fictional time consumption, and the six temporal event types remained deferred.

To fulfill Domain Rules 8 (Travel consumes fictional time), 6 (Knowledge filtered by proximity), 7 (Camera changes what is presented, not what exists), 9 (Persistent character development requires causal evidence), and ADR-010 (Agendas, Schedules, and World Life), LWS requires an authoritative temporal progression engine, character routine arbitration, spatial travel mechanics, scheduled world events with reciprocal supersession integrity, and pure zero-SQL replay parity.

## Decision

We adopt an **Authoritative Temporal Progression, Schedules, Routines, and Travel Architecture**:

1. **Discrete Temporal Progression (`TIME_ADVANCE`)**:
   - Time advances discretely through the simulation engine via `POST /simulations/:simLwsId/time-advance`.
   - The timeline resolution engine discovers critical points in $(T_{\text{start}}, T_{\text{target}}]$ comprising:
     - Scheduled event trigger timestamps.
     - Character routine planned travel departure timestamps ($T_{\text{dep}} = T_{\text{start}} - \text{duration}$).
     - In-transit character arrival timestamps ($T_{\text{arr}}$).
   - Temporal events at the same timestamp are deterministically ordered by sub-event priority:
     1. Scheduled event triggers (`TRIGGER_SCHEDULED_EVENT`).
     2. In-transit arrivals (`RELOCATE_CHARACTER` + `UPDATE_RUNTIME_STATE` + `UPDATE_CHARACTER_ACTIVITY`).
     3. Routine activity changes & travel departures (`UPDATE_RUNTIME_STATE` + `UPDATE_CHARACTER_ACTIVITY`).
   - Tie-breaking within the same sub-event type is deterministically ordered by entity ID (`lws_id`).
   - Zero-duration advance ($T_{\text{target}} = T_{\text{start}}$) is idempotent, generating zero consequence events and zero ledger mutations.

2. **Three Fictional Timestamp Classes & Clock Authority**:
   - **Direct Events**: Normal external proposals must match the simulation's current fictional clock ($T_{\text{event}} = T_{\text{current}}$).
   - **Consequence Events**: Generated exclusively by the internal simulation engine during temporal progression, falling strictly within $[T_{\text{start}}, T_{\text{target}}]$.
   - **Root Advance**: The authoritative `TIME_ADVANCE` event timestamp is positioned exactly at $T_{\text{target}}$.
   - Database trigger `trg_lws_events_monotonic_and_sequence` enforces sequence monotonicity and non-retroactive timestamps at the SQLite boundary.

3. **Character Routines & 6-Tier Activity Arbitration**:
   - Authored routines are persisted in `lws_simulation_character_routines` (schema version 5).
   - Character activity is deterministically arbitrated via a 6-tier hierarchy:
     1. **Tier 1 (Severe Physical Condition)**: Incapacitated or unconscious state suspends active routines and travel, forcing activity to condition name.
     2. **Tier 2 (Manual Override / Active Conversation)**: Manual activity override or active dialogue locks character activity.
     3. **Tier 3 (In-Transit Travel)**: Active travel enforces `travelling` activity until arrival.
     4. **Tier 4 (Specific Day Routine)**: Highest priority routine explicitly matching the day of the week.
     5. **Tier 5 (Daily Routine)**: Highest priority routine configured for `daily` recurrence.
     6. **Tier 6 (Default Idle)**: `idle` at current location when no routine blocks match.
   - Routines support 24-hour time formats, overnight wrapping ($T_{\text{start}} > T_{\text{end}}$), and routine resurrection upon `PUT` (preserving stable entity identity).

4. **Spatial Travel & Lifecycle Mechanics**:
   - Spatial distance between locations is computed via hierarchical tree Lowest Common Ancestor (LCA) distance ($d = \text{depth}(A) + \text{depth}(B) - 2 \cdot \text{depth}(\text{LCA})$) with authored connection overrides.
   - Travel duration is $d \times \text{speed\_multiplier}$; planned departure time is $T_{\text{dep}} = T_{\text{start}} - \text{duration}$.
   - Complete travel lifecycle:
     - Departure: `UPDATE_RUNTIME_STATE` (`status: 'in_transit'`) + `UPDATE_CHARACTER_ACTIVITY` (`activity: 'travelling'`).
     - Arrival: `RELOCATE_CHARACTER` + `UPDATE_RUNTIME_STATE` (`travel: null`) + `UPDATE_CHARACTER_ACTIVITY` (routine activity).
   - Travel suspension occurs if a severe physical condition intervenes, retaining remaining travel duration. Travel resumes upon condition clearance if the destination routine remains valid.

5. **Scheduled World Events & Reciprocal Supersession**:
   - Persisted in `lws_scheduled_events` (schema version 5) with states `pending`, `triggered`, `cancelled`, and `superseded`.
   - Triggers `trg_lws_sched_events_insert_integrity` and `trg_lws_sched_events_update_integrity` enforce bidirectional supersession consistency at the database engine boundary:
     $$\text{predecessor.superseded\_by\_event\_id} = \text{successor.id} \iff \text{successor.supersedes\_event\_id} = \text{predecessor.id}$$
   - Predecessor status is atomically locked to `superseded`.

6. **One Authoritative Path & Dedicated Route Required**:
   - Generic `POST /simulations/:simLwsId/events` strictly rejects all six Phase 5 event types (`TIME_ADVANCE`, `SCHEDULE_WORLD_EVENT`, `CANCEL_SCHEDULED_EVENT`, `SUPERSEDE_SCHEDULED_EVENT`, `TRIGGER_SCHEDULED_EVENT`, `UPDATE_CHARACTER_ROUTINE`) with HTTP 422 `DEDICATED_ROUTE_REQUIRED`.
   - Dedicated validated endpoints govern all time, schedule, and routine commands.

7. **Zero-SQL Pure Replay Parity**:
   - `simulationReducer` reduces all 6 Phase 5 events in-memory without issuing database queries.
   - `verifySimulationParity` inspects complete simulation runtime state, character activities/locations/runtimes, routines, and scheduled events, asserting 100% attribute parity against SQLite projections.

## Consequences

- **Autonomous Simulation**: Fictional time moves forward deterministically; characters depart, travel across the world graph, and arrive at routine activities without manual turn intervention.
- **Strict Causality**: Movement and schedule triggers generate immutable, auditable events in `lws_events`.
- **Database Boundary Hardening**: Reciprocal supersession, clock monotonicity, simulation immutability, and soft-delete guards are guaranteed at the database trigger layer.
- **Zero In-Memory Drift**: Replaying the event ledger reproduces the exact simulation projection down to character coordinates, activities, routines, and scheduled event statuses.
- **Architectural Conformance**: Strictly enforces Domain Rules 6, 7, 8, 9, 14, and ADR-002, ADR-004, ADR-006, ADR-010, ADR-011, and ADR-012.
