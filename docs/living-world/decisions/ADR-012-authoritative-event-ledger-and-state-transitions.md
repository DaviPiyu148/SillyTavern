# ADR-012: Authoritative Event Ledger and State Transitions

## Status

Accepted

## Context

In Phase 3, Living World Simulator established runtime persistence for simulations and characters via `lws_simulations` and `lws_simulation_characters`. However, state updates were applied directly to table rows, creating risk of state drift, unrecorded side effects, and lack of causal audit trails. Furthermore, LLM or client inputs could directly dictate simulation outcomes without authoritative validation.

To enforce the core LWS invariant:
> **LLM/User Proposes → Simulation Engine Decides → Database Records Reality → Narrative Presents Reality**

LWS requires an authoritative event ledger, a strict authority evaluation pipeline, durable narrative turn auditing, and pure in-memory replay capabilities.

## Decision

We adopt an **Authoritative Event Ledger and State Transition Architecture**:

1. **Authoritative Event Ledger (`lws_events`)**:
   - Simulation state mutations are driven strictly by committing events to `lws_events`.
   - The ledger is strictly append-only. Triggers `trg_lws_events_immutable_all` and `trg_lws_events_no_delete` prevent any `UPDATE` or `DELETE` at the database engine boundary.
   - Events are strictly sequenced per simulation (`simulation_id`, `sequence_number`), with unique index `idx_lws_events_sim_seq` and monotonic sequence generation enforcing unbroken incremental sequencing.
   - Content-addressable SHA-256 idempotency fingerprinting prevents duplicate event application upon retries.

2. **Closed 29-Event Taxonomy**:
   - The system recognizes a closed catalog of 29 event types: 23 active Phase 4 events, 6 deferred Phase 5 events (scheduled/time/routine), and exactly 13 stateful events that project into SQLite runtime tables.
   - Unrecognized event types are strictly rejected at the schema validation boundary.

3. **Four-Stage Authority Evaluation Pipeline**:
   - **Stage 1 (Schema Validation)**: Validates required payload fields, type correctness, and rejects unknown properties.
   - **Stage 2 (Structural & Provenance Checks)**: Authenticates provenance; enforces that `system` and `simulation_engine` provenances cannot be forged by external callers, and `director` requires admin privileges (`req.user?.profile?.admin === true`). Verifies character-actor simulation membership and spatial collocation where required.
   - **Stage 3 (Domain Validation)**: Evaluates status transition legality, prevents assigning soft-deleted locations, and verifies clock synchronization against the simulation clock.
   - **Stage 4 (Authority Decision)**: Authorizes and commits the event or rejects it with structured error codes and domain failure details.

4. **Two-Transaction Savepoint Execution for Narrative Turns (`lws_narrative_turns`)**:
   - **Transaction A**: Inserts the narrative turn in `pending` status and immediately commits, establishing durable audit identity.
   - **Transaction B**: Establishes `SAVEPOINT proposal_batch`. Evaluates and executes proposed events and projects state transitions.
     - On success: Releases savepoint, transitions turn status to `committed`, and commits Transaction B.
     - On failure: Executes `ROLLBACK TO SAVEPOINT`, releases savepoint, transitions turn status to `rejected`, stores `error_details`, and commits Transaction B. Durable rejection auditing is preserved without rolling back turn history.
   - Triggers `trg_lws_narrative_turns_terminal_immutable` and `trg_lws_narrative_turns_no_delete` guarantee narrative turn immutability once finalized.

5. **Elimination of Phase 3 Mutation Bypasses**:
   - All Phase 3 simulation and simulation-character mutation functions (`updateSimulation`, `deleteSimulation`, `addSimulationCharacter`, `updateSimulationCharacter`, `deleteSimulationCharacter`) are refactored to delegate strictly through `commitEvent`.
   - No direct SQL `UPDATE` or `DELETE` statements on runtime state exist outside the projection engine.

6. **Pure In-Memory Zero-SQL Replay Engine**:
   - `simulationReducer` and `replaySimulation(events)` fold an ordered sequence of events from sequence 1 through N in pure memory without issuing any database queries or external lookups.
   - `verifySimulationParity` compares pure in-memory fold projections against projected SQLite rows, proving 100% attribute parity and detecting zero drift.

## Consequences

- **Guaranteed Causality**: Authoritative reality is entirely reconstructed from the event ledger; state cannot change without an auditable causal event.
- **Untrusted Proposal Isolation**: Neither LLM generations nor untrusted client requests can directly mutate authoritative simulation state.
- **Durable Audit Trail**: All proposals, committed turns, and rejected turns are permanently persisted for debugging, analysis, and replay.
- **Zero Drift**: SQLite projection rows match the deterministic pure in-memory event fold across all canonical simulation and character attributes.
- **Architectural Conformance**: Strictly enforces Domain Rules 3, 4, 7, 9, 14, and ADR-002, ADR-004, ADR-006, and ADR-011.
