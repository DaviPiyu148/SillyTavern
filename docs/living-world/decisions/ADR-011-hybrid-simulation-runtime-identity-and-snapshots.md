# ADR-011: Hybrid Simulation Runtime Identity and Frozen Authored Snapshots

## Status

Accepted

## Context

Living World Simulator (LWS) requires characters to participate in one or more concurrent or historical simulations. When instantiating an authored character (`lws_characters`) into a simulation runtime, a clear model for identity, lineage, and runtime mutation is required:
1. Pure Reference: Simulation characters hold only a foreign key reference to authored characters and resolve descriptive metadata on every read. However, if an author edits or soft-deletes a character definition, active and archived simulations would retroactively change or break.
2. Pure Clone: Simulation characters copy authored data into independent runtime character entities with no foreign key relationship. However, this loses provenance and prevents cross-simulation identity correlation.

## Decision

We adopt a **Hybrid Model** for simulation runtime character identity and persistence:

1. **Dedicated Runtime Table (`lws_simulation_characters`)**:
   Runtime characters exist exclusively in `lws_simulation_characters`, distinct from `lws_characters`. Each instance has its own unique primary key and `lws_id` UUID.

2. **Immutable Authored Lineage Reference**:
   Each `lws_simulation_characters` row maintains a foreign key `character_id` referencing `lws_characters.id`. At the database boundary, the trigger `trg_lws_sim_chars_character_id_immutable` prevents mutating `character_id` on `UPDATE`.

3. **Frozen Authored Snapshot**:
   At the moment of instantiation (via scenario roster instantiation or explicit addition), an immutable JSON snapshot (`authored_snapshot`) capturing the character's authored card state (`name`, `description`, `personality`, `scenario`, `mes_example`, `creator_notes`, `system_prompt`, `character_version`, `tags`, `extensions`) is recorded. At the database boundary, the trigger `trg_lws_sim_chars_snapshot_immutable` prevents mutating `authored_snapshot` on `UPDATE`.

4. **Exclusive Runtime Mutability**:
   Runtime state changes (such as `current_location_id`, `activity`, `physical_condition`, `runtime_state`, `updated_at`, and `deleted_at`) occur exclusively on `lws_simulation_characters`.

5. **Strict Authored Isolation**:
   The authored `lws_characters` table contains no runtime columns (`activity`, `current_location_id`, `physical_condition`, `runtime_state`) and is never written to during runtime simulation execution.

## Consequences

- **Two-Simulation Independence**: Two simulations running within the same world can instantiate the same authored character and progress through divergent storylines, locations, and conditions without state collision or cross-talk.
- **Historical Durability**: Edits or soft-deletes made to authored character records do not alter, invalidate, or break active or archived simulations.
- **Lineage and Provenance**: Simulations retain clear provenance indicating which authored entity originated the runtime participant.
- **Architectural Conformance**: Strictly enforces Domain Rule 5 ("Authored definitions and simulation runtime state remain separate") and ADR-006.
