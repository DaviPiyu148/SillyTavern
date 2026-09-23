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
    - `world_id` immutability on `lws_simulations`
    - `scenario_id` immutability on `lws_simulations`
    - Scenario same-world foreign key verification on simulation insertion
    - Simulation status lifecycle transitions (`active` ⇄ `paused`, `active`/`paused` → `archived`, `archived` terminal)
    - `simulation_id` immutability on `lws_simulation_characters`
    - `character_id` immutability on `lws_simulation_characters`
    - `authored_snapshot` immutability on `lws_simulation_characters`
    - Character same-world foreign key verification on runtime character insertion
    - Location same-world foreign key verification on runtime character insertion
    - Soft-deleted location assignment guards (`trg_lws_sim_chars_location_insert` and `trg_lws_sim_chars_location_update`), blocking new assignment of soft-deleted locations while preserving existing references.
  - 5 performance and integrity indexes:
    - `idx_lws_simulations_world_status` on `lws_simulations(world_id, status)`
    - `idx_lws_simulations_name_active` (partial unique index on `lws_simulations(world_id, name) WHERE deleted_at IS NULL COLLATE NOCASE`)
    - `idx_lws_sim_chars_sim_char_active` (partial unique index on `lws_simulation_characters(simulation_id, character_id) WHERE deleted_at IS NULL`)
    - `idx_lws_sim_chars_sim` on `lws_simulation_characters(simulation_id)`
    - `idx_lws_sim_chars_location` on `lws_simulation_characters(current_location_id)`



