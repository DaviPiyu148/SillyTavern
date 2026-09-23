# LWS Persistence

## Storage

SQLite is the v0.1 persistence mechanism.

Intended host location:

```text
data/living-world/lws.sqlite
```

Keep LWS persistence separate from normal ST chat storage.

## Persistent state/history

Persist, as applicable:
- Worlds and versions;
- Simulations;
- runtime character state;
- locations and relevant runtime state;
- events and causality;
- scheduled events;
- relationships;
- knowledge;
- memories;
- goals/activities;
- development records;
- resources/inventory;
- meaningful observation/camera state;
- narrative turn metadata;
- schema/migration versioning.

## Not authoritative

Do not make these the primary simulation store:
- LLM context;
- chat transcript;
- `chat_metadata`;
- macros/variables;
- rendered narrative;
- UI state.

## Event-sourced state

Where event sourcing applies:

```text
committed immutable events
→ reducer/replay
→ reconstructed runtime state
```

Projections may accelerate reads, but must not silently replace the event authority where replay parity is required.

## Transaction rule

```text
validate
→ stage events/state transition
→ commit atomically
```

Invalid consequential proposals must not partially mutate authoritative state.

## Simulation isolation

Runtime state is scoped to a simulation. Two simulations may share authored definitions but never mutable runtime objects.

## Long-term continuity

The LLM remembers a past event because LWS persisted it and the context system retrieved the relevant memory/knowledge/state, not because the original message is still inside the context window.

## Replay

Replay uses the immutable event sequence, avoids LLM calls, and should reproduce supported state deterministically.

## Migrations

Schema changes require explicit, versioned migrations and verification.

### Applied migrations

- `001_initial`: Baseline LWS metadata schema (`lws_meta` table, `user_version = 1`).
- `002_authored_model`: Canonical authored model (`user_version = 2`): 9 tables (`lws_worlds`, `lws_characters`, `lws_locations`, `lws_factions`, `lws_scenarios`, `lws_world_rules`, `lws_authored_prompt_configs`, `lws_character_factions`, `lws_scenario_characters`), 12 integrity and immutability triggers, and 5 partial unique indexes for active entities.
  - *Implementation enhancements included in Phase 2*:
    - **Hierarchical Locations**: Self-referential `lws_locations.parent_location_id` foreign key supporting tree hierarchies (e.g. World → Region → City → Building → Room) with parent existence/world validation and circular-reference detection.
    - **Active Name Uniqueness**: 5 partial unique indexes (`WHERE deleted_at IS NULL` with `COLLATE NOCASE`) enforcing case-insensitive name uniqueness within world scope for active records across worlds, characters, locations, factions, and scenarios, allowing soft-deleted entity names to be reused.
- `003_simulation_runtime`: Simulation runtime and persistence (`user_version = 3`):
  - 2 tables: `lws_simulations` (runtime instance, fictional timestamp, status, settings, extensions) and `lws_simulation_characters` (runtime character instance, current location, activity, physical condition, runtime state, and frozen `authored_snapshot`).
  - 10 database triggers enforcing:
    1. `trg_lws_simulations_world_id_immutable`: Blocks mutating `world_id` on simulations.
    2. `trg_lws_simulations_scenario_id_immutable`: Blocks mutating `scenario_id` on simulations.
    3. `trg_lws_simulations_scenario_same_world_insert`: Verifies scenario belongs to the same world on simulation insertion.
    4. `trg_lws_simulations_status_transition`: Enforces simulation status lifecycle matrix (`active` ⇄ `paused`, `active`/`paused` → `archived`, `archived` terminal).
    5. `trg_lws_sim_chars_simulation_id_immutable`: Blocks mutating `simulation_id` on runtime characters.
    6. `trg_lws_sim_chars_character_id_immutable`: Blocks mutating `character_id` on runtime characters.
    7. `trg_lws_sim_chars_authored_snapshot_immutable`: Blocks mutating `authored_snapshot` on runtime characters.
    8. `trg_lws_sim_chars_same_world_insert`: Verifies character belongs to simulation's world on insertion.
    9. `trg_lws_sim_chars_location_insert`: Verifies location belongs to simulation's world and prevents newly assigning a soft-deleted location on insertion.
    10. `trg_lws_sim_chars_location_update`: Verifies location belongs to simulation's world and prevents newly assigning a soft-deleted location on update, while preserving existing references.
  - 5 performance and integrity indexes:
    - `idx_lws_simulations_world`: Fast filtering of active simulations by parent world (`lws_simulations(world_id) WHERE deleted_at IS NULL`).
    - `idx_lws_simulations_name_active`: Partial unique index enforcing case-insensitive name uniqueness among active simulations within a world (`lws_simulations(world_id, name COLLATE NOCASE) WHERE deleted_at IS NULL`).
    - `idx_lws_sim_chars_sim`: Fast lookup of active simulation characters by simulation (`lws_simulation_characters(simulation_id) WHERE deleted_at IS NULL`).
    - `idx_lws_sim_chars_unique_active`: Partial unique index preventing duplicate active character assignment in a simulation (`lws_simulation_characters(simulation_id, character_id) WHERE deleted_at IS NULL`).
    - `idx_lws_sim_chars_location`: Fast lookup of active characters by current location (`lws_simulation_characters(current_location_id) WHERE deleted_at IS NULL`).
  - Simulation soft-deletion semantics:
    - Sets `deleted_at = isoNow()` and `updated_at = isoNow()` on `lws_simulations`.
    - Child `lws_simulation_characters` rows remain physically intact and unchanged in SQLite for auditability and future replay; child routes under `/simulations/:simLwsId/characters/*` return HTTP 404 via parent simulation status gating.
- `004_events_and_authority`: Authoritative event ledger, narrative turns, and state transition integrity (`user_version = 4`):
  - 2 tables: `lws_narrative_turns` (turn tracking, user input, model outputs, turn status: pending, committed, rejected, failed, error_details, model_info) and `lws_events` (canonical append-only event ledger: id, lws_id, simulation_id, sequence_number, event_type, fictional_time, actor_character_id, target_character_id, authored_character_id, location_id, payload, provenance, causal_event_id, turn_id, idempotency_key, created_at).
  - Exactly 16 database triggers:
    1. `trg_lws_events_immutable_all`: Prohibits direct `UPDATE` on `lws_events`.
    2. `trg_lws_events_no_delete`: Prohibits direct `DELETE` on `lws_events`.
    3. `trg_lws_events_same_sim_actor`: Enforces that `actor_character_id` belongs to the same simulation as the event.
    4. `trg_lws_events_same_sim_target`: Enforces that `target_character_id` belongs to the same simulation as the event.
    5. `trg_lws_events_same_world_authored`: Enforces that `authored_character_id` belongs to the same world as the simulation.
    6. `trg_lws_events_same_world_location`: Enforces that `location_id` belongs to the same world as the simulation.
    7. `trg_lws_events_fictional_time_matches_sim`: Enforces that event `fictional_time` matches parent simulation `current_fictional_time`.
    8. `trg_lws_events_causal_integrity`: Enforces that `causal_event_id` belongs to the same simulation and has a strictly preceding sequence (`sequence_number < NEW.sequence_number`).
    9. `trg_lws_events_same_sim_turn`: Enforces that `turn_id` belongs to the same simulation as the event.
    10. `trg_lws_events_char_actor_required`: Requires `actor_character_id` on character-specific state events (`MOVE_CHARACTER`, `UPDATE_CHARACTER_ACTIVITY`, `UPDATE_PHYSICAL_CONDITION`, `UPDATE_RUNTIME_STATE`, `CHARACTER_LEAVE`, `REST`, `WORK`, `CONSUME_ITEM`).
    11. `trg_lws_events_start_actor_prohibited`: Prohibits `actor_character_id` or `target_character_id` on `SIMULATION_START`.
    12. `trg_lws_events_join_authored_required`: Requires `authored_character_id` on `CHARACTER_JOIN`.
    13. `trg_lws_narrative_turns_sim_immutable`: Prohibits mutating `simulation_id` on narrative turns.
    14. `trg_lws_narrative_turns_turn_num_immutable`: Prohibits mutating `turn_number` on narrative turns.
    15. `trg_lws_narrative_turns_terminal_immutable`: Enforces terminal turn states (`committed`, `rejected`, `failed` turns cannot be mutated).
    16. `trg_lws_narrative_turns_no_delete`: Prohibits direct `DELETE` on narrative turns.
  - Exactly 7 indexes:
    1. `idx_lws_events_sim_seq`: Unique index on `lws_events(simulation_id, sequence_number)`.
    2. `idx_lws_events_sim_time`: Index on `lws_events(simulation_id, fictional_time, sequence_number)`.
    3. `idx_lws_events_actor`: Partial index on `lws_events(actor_character_id) WHERE actor_character_id IS NOT NULL`.
    4. `idx_lws_events_authored_char`: Partial index on `lws_events(authored_character_id) WHERE authored_character_id IS NOT NULL`.
    5. `idx_lws_events_idempotency`: Partial unique index on `lws_events(simulation_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
    6. `idx_lws_events_turn`: Partial index on `lws_events(turn_id) WHERE turn_id IS NOT NULL`.
    7. `idx_lws_narrative_turns_sim_turn`: Unique index on `lws_narrative_turns(simulation_id, turn_number)`.
  - Pure in-memory zero-SQL replay engine (`replaySimulation` and `verifySimulationParity` via `POST /api/living-world/simulations/:simLwsId/replay-verify`).
  - Elimination of Phase 3 mutation bypasses: `lws_simulations` and `lws_simulation_characters` mutations delegate strictly through `commitEvent`.

