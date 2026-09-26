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
- `005_time_and_schedules`: Fictional time, schedules, routines, and travel (`user_version = 5`):
  - Exactly 2 new tables:
    1. `lws_simulation_character_routines`: Authored character routine schedule blocks (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `block_id`, `day_of_week`, `start_time`, `end_time`, `activity`, `target_location_id`, `priority`, `flexibility`, `enabled`, `created_at`, `updated_at`, `deleted_at`).
    2. `lws_scheduled_events`: Authored and dynamically scheduled world events (`id`, `lws_id`, `simulation_id`, `scheduled_fictional_time`, `title`, `description`, `target_location_id`, `payload`, `status`, `supersedes_event_id`, `superseded_by_event_id`, `trigger_event_id`, `cancel_event_id`, `created_at`, `updated_at`).
  - Exactly 9 Phase 5 triggers (1 evolved ledger trigger + 4 routine triggers + 4 scheduled-event triggers; 24 cumulative across system):
    1. `trg_lws_events_monotonic_and_sequence`: Replaces `trg_lws_events_fictional_time_matches_sim`, enforcing sequence monotonicity, clock non-retroactivity ($T_{\text{event}} \ge T_{\text{current}}$ for sequence 1 or direct proposals, $T_{\text{event}} \ge T_{\text{prev}}$), and exact unbroken incremental sequence numbers.
    2. `trg_lws_routines_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on routine updates.
    3. `trg_lws_routines_char_same_sim`: Validates that character belongs to simulation and target location belongs to simulation world and is not soft-deleted on routine insertion.
    4. `trg_lws_routines_same_world_loc`: Validates that updated target location belongs to simulation world and is not soft-deleted.
    5. `trg_lws_routines_no_delete`: Enforces soft-delete only for routines, prohibiting direct `DELETE`.
    6. `trg_lws_sched_events_sim_immutable`: Validates location, self-supersession, predecessor status (`pending`), reciprocal successor linkage, and trigger/cancel event linkages on insertion.
    7. `trg_lws_sched_events_terminal_immutable`: Prevents updates to terminal scheduled events (`triggered`, `cancelled`, `superseded`).
    8. `trg_lws_sched_events_integrity`: Enforces simulation immutability, location validity, immutable established supersession, reciprocal supersession consistency, and trigger/cancel event linkages on update.
    9. `trg_lws_sched_events_no_delete`: Prohibits direct `DELETE` on scheduled events.
  - Exactly 4 new indexes (11 cumulative across Phase 4 & 5 tables):
    1. `idx_lws_routines_sim_char`: Fast lookup of active routines by simulation character (`lws_simulation_character_routines(simulation_id, simulation_character_id) WHERE deleted_at IS NULL`).
    2. `idx_lws_routines_lookup`: Fast routine lookup by character, day of week, and start time (`lws_simulation_character_routines(simulation_character_id, day_of_week, start_time) WHERE deleted_at IS NULL`).
    3. `idx_lws_sched_events_sim_time`: Fast chronological lookup of pending scheduled events (`lws_scheduled_events(simulation_id, scheduled_fictional_time) WHERE status = 'pending'`).
    4. `idx_lws_sched_events_sim_status`: Filtering of scheduled events by simulation and status (`lws_scheduled_events(simulation_id, status)`).
- `006_perception_and_knowledge`: Perception, knowledge, memory, beliefs, and camera observation (`user_version = 6`):
  - Exactly 5 new tables:
    1. `lws_event_perceptions`: Immutable character event perception ledger (`id`, `lws_id`, `simulation_id`, `event_id`, `simulation_character_id`, `sensory_modality`, `perceived_at_fictional_time`, `created_at`).
    2. `lws_character_knowledge`: Subjective character knowledge facts (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `fact_key`, `content`, `source_channel`, `source_character_id`, `source_event_id`, `fictional_time_acquired`, `created_at`, `updated_at`, `deleted_at`).
    3. `lws_character_memories`: Character episodic/semantic memories (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `summary`, `details`, `memory_type`, `event_id`, `fictional_time`, `emotional_salience`, `importance`, `confidence`, `status`, `tags`, `source_channel`, `created_at`, `updated_at`, `deleted_at`).
    4. `lws_character_beliefs`: Character beliefs and suspicions (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `subject_key`, `belief_type`, `statement`, `confidence`, `source_basis`, `causal_event_id`, `created_at`, `updated_at`, `deleted_at`).
    5. `lws_simulation_cameras`: Multi-mode simulation camera states (`id`, `lws_id`, `simulation_id`, `camera_name`, `mode`, `target_character_id`, `target_location_id`, `created_at`, `updated_at`).
  - Exactly 15 Phase 6 triggers (39 cumulative across system):
    1. `trg_lws_perceptions_immutable`: Prohibits direct updates on `lws_event_perceptions`.
    2. `trg_lws_perceptions_no_delete`: Prohibits direct physical `DELETE` on `lws_event_perceptions`.
    3. `trg_lws_perceptions_same_sim`: Validates event and character belong to perception simulation.
    4. `trg_lws_knowledge_identity_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on knowledge.
    5. `trg_lws_knowledge_insert_integrity`: Validates character, source character, and source event belong to simulation on knowledge insertion.
    6. `trg_lws_knowledge_no_delete`: Prohibits direct physical `DELETE` on knowledge (requires soft-delete).
    7. `trg_lws_memories_identity_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on memories.
    8. `trg_lws_memories_insert_integrity`: Validates character and event reference belong to simulation on memory insertion.
    9. `trg_lws_memories_no_delete`: Prohibits direct physical `DELETE` on memories (requires soft-delete).
    10. `trg_lws_beliefs_identity_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on beliefs.
    11. `trg_lws_beliefs_insert_integrity`: Validates character and causal event reference belong to simulation on belief insertion.
    12. `trg_lws_beliefs_no_delete`: Prohibits direct physical `DELETE` on beliefs (requires soft-delete).
    13. `trg_lws_cameras_identity_immutable`: Enforces immutability of `simulation_id` and `camera_name` on `lws_simulation_cameras`.
    14. `trg_lws_cameras_insert_integrity`: Validates mode/target invariants and cross-simulation lineage on camera insertion.
    15. `trg_lws_cameras_update_integrity`: Validates mode/target invariants and cross-simulation lineage on camera update.
  - Exactly 10 new indexes (21 cumulative across Phase 4–6 tables):
    1. `idx_lws_perceptions_event`: Index on `lws_event_perceptions(event_id, simulation_character_id)`.
    2. `idx_lws_perceptions_char_time`: Index on `lws_event_perceptions(simulation_character_id, perceived_at_fictional_time)`.
    3. `idx_lws_knowledge_char_lookup`: Index on `lws_character_knowledge(simulation_character_id, fact_key) WHERE deleted_at IS NULL`.
    4. `idx_lws_knowledge_sim_char`: Index on `lws_character_knowledge(simulation_id, simulation_character_id) WHERE deleted_at IS NULL`.
    5. `idx_lws_memories_char_time`: Index on `lws_character_memories(simulation_character_id, fictional_time DESC) WHERE deleted_at IS NULL`.
    6. `idx_lws_memories_char_salience`: Index on `lws_character_memories(simulation_character_id, emotional_salience DESC) WHERE deleted_at IS NULL`.
    7. `idx_lws_memories_sim_char`: Index on `lws_character_memories(simulation_id, simulation_character_id) WHERE deleted_at IS NULL`.
    8. `idx_lws_beliefs_lookup`: Index on `lws_character_beliefs(simulation_character_id, subject_key) WHERE deleted_at IS NULL`.
    9. `idx_lws_beliefs_sim_char`: Index on `lws_character_beliefs(simulation_id, simulation_character_id) WHERE deleted_at IS NULL`.
    10. `idx_lws_cameras_sim`: Index on `lws_simulation_cameras(simulation_id, camera_name)`.
- `007_cognition_and_decisions`: Character cognition, goals, intentions, values, emotions, and internal deliberation (`user_version = 7`):
  - Exactly 5 new tables:
    1. `lws_character_needs`: Tracks physiological and psychological need levels (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `need_type`, `current_value`, `decay_rate`, `recovery_rate`, `last_updated_fictional_time`, `created_at`, `updated_at`).
    2. `lws_character_goals`: Hierarchical goal management (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `parent_goal_id`, `client_goal_key`, `title`, `description`, `goal_type`, `priority`, `urgency`, `status`, `target_entity_type`, `target_entity_id`, `progress`, `created_at`, `updated_at`, `deleted_at`).
    3. `lws_character_intentions`: Concrete action commitments (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `goal_id`, `character_sequence_number`, `simulation_sequence_number`, `activity`, `target_location_id`, `target_character_id`, `status`, `plan_steps`, `failure_reason`, `created_at`, `updated_at`).
    4. `lws_character_values`: Personality values (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `value_type`, `alignment_score`, `weight`, `stability`, `created_at`, `updated_at`).
    5. `lws_character_emotions`: Subjective emotional states (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `emotion_type`, `valence`, `arousal`, `intensity`, `decay_rate`, `onset_fictional_time`, `created_at`, `updated_at`).
  - Exactly 15 Phase 7 triggers (55 cumulative across Phase 4–7 tables):
    1. `trg_lws_needs_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on needs.
    2. `trg_lws_needs_insert_integrity`: Validates character belongs to simulation on need insertion.
    3. `trg_lws_needs_no_delete`: Prohibits direct physical `DELETE` on needs.
    4. `trg_lws_goals_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on goals.
    5. `trg_lws_goals_insert_integrity`: Validates character belongs to simulation and parent goal consistency on insertion.
    6. `trg_lws_goals_terminal_immutable`: Freezes terminal goals (`completed`, `abandoned`).
    7. `trg_lws_goals_no_delete`: Prohibits direct physical `DELETE` on goals (requires soft-delete).
    8. `trg_lws_intentions_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on intentions.
    9. `trg_lws_intentions_insert_integrity`: Validates character, goal, and event reference belong to simulation on intention insertion.
    10. `trg_lws_intentions_terminal_immutable`: Freezes terminal intentions (`completed`, `failed`, `cancelled`).
    11. `trg_lws_intentions_no_delete`: Prohibits direct physical `DELETE` on intentions.
    12. `trg_lws_values_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on values.
    13. `trg_lws_values_insert_integrity`: Validates character belongs to simulation on value insertion.
    14. `trg_lws_values_no_delete`: Prohibits direct physical `DELETE` on values.
    15. `trg_lws_emotions_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on emotions.
  - Exactly 10 new indexes (31 cumulative across Phase 4–7 tables):
    1. `idx_lws_needs_sim_char`: Index on `lws_character_needs(simulation_id, simulation_character_id)`.
    2. `idx_lws_goals_sim_char`: Index on `lws_character_goals(simulation_id, simulation_character_id) WHERE deleted_at IS NULL`.
    3. `idx_lws_goals_status`: Index on `lws_character_goals(simulation_id, status) WHERE deleted_at IS NULL`.
    4. `idx_lws_goals_client_key_unique`: Non-partial unique index on `lws_character_goals(simulation_id, simulation_character_id, client_goal_key) WHERE client_goal_key IS NOT NULL`.
    5. `idx_lws_intentions_sim_char`: Index on `lws_character_intentions(simulation_id, simulation_character_id)`.
    6. `idx_lws_intentions_status`: Index on `lws_character_intentions(simulation_id, status)`.
    7. `idx_lws_intentions_char_seq`: Unique index on `lws_character_intentions(simulation_id, simulation_character_id, character_sequence_number)`.
    8. `idx_lws_values_sim_char`: Index on `lws_character_values(simulation_id, simulation_character_id)`.
    9. `idx_lws_emotions_sim_char`: Index on `lws_character_emotions(simulation_id, simulation_character_id)`.
    10. `idx_lws_emotions_char_time`: Index on `lws_character_emotions(simulation_character_id, onset_fictional_time DESC)`.
  - Cumulative database inventory: Exactly 26 tables (1 Phase 1 table `lws_meta` + 9 Phase 2 tables + 2 Phase 3 tables + 2 Phase 4 tables + 2 Phase 5 tables + 5 Phase 6 tables + 5 Phase 7 tables = 26 total tables), exactly 55 triggers on Phase 4–7 tables (Phase 4: 16, Phase 5: 9, Phase 6: 15, Phase 7: 15 = 55), and exactly 31 indexes on Phase 4–7 tables (Phase 4: 7, Phase 5: 4, Phase 6: 10, Phase 7: 10 = 31).
  - Event-backed goal mutations: All goal lifecycle state transitions execute strictly via `UPDATE_RUNTIME_STATE` (P0-1 correction).
  - Option B failed intentions: Failed intention state transitions persist failure reason and execution metadata via `UPDATE_RUNTIME_STATE`.
  - Pure in-memory zero-SQL replay engine expanded to fold all Phase 7 cognition state transitions with 100% tested field-level parity for the declared Phase 7 cognition state against SQLite database state.
- `008_social_and_development`: Social systems, relationships, rumors, factions, and character development (`user_version = 8`):
  - Exactly 5 new tables:
    1. `lws_character_relationships`: Directed dynamic character relationships (`id`, `lws_id`, `simulation_id`, `source_character_id`, `target_character_id`, `trust`, `affection`, `familiarity`, `respect`, `loyalty`, `last_interaction_fictional_time`, `created_at`, `updated_at`, `deleted_at`).
    2. `lws_relationship_evidence`: Causal evidence backing relationship metrics (`id`, `lws_id`, `simulation_id`, `relationship_id`, `source_character_id`, `target_character_id`, `causal_event_id`, `fictional_time`, `delta_trust`, `delta_affection`, `delta_familiarity`, `delta_respect`, `delta_loyalty`, `interaction_type`, `narrative_rationale`, `created_at`).
    3. `lws_social_information`: Rumors, claims, information propagation, and social knowledge trees (`id`, `lws_id`, `simulation_id`, `parent_social_information_id`, `root_social_information_id`, `originator_character_id`, `transmitter_character_id`, `recipient_character_id`, `causal_event_id`, `subject_key`, `topic`, `claim_statement`, `veracity`, `ground_truth_event_id`, `distortion_level`, `transmission_depth`, `confidence_score`, `fictional_time`, `created_at`).
    4. `lws_character_faction_memberships`: Runtime faction memberships, ranks, and standing (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `faction_id`, `rank_role`, `standing`, `loyalty_score`, `membership_status`, `joined_fictional_time`, `created_at`, `updated_at`, `deleted_at`).
    5. `lws_character_development_records`: Causal historical development records, milestones, value shifts, habit shifts, and baseline need shifts (`id`, `lws_id`, `simulation_id`, `simulation_character_id`, `dimension_category`, `dimension_key`, `previous_value`, `new_value`, `delta`, `trigger_category`, `causal_event_ids`, `stability`, `fictional_time`, `created_at`).
  - Exactly 15 Phase 8 triggers (70 cumulative across Phase 4–8 tables, 80 cumulative across all tables):
    1. `trg_lws_character_relationships_no_self_rel`: Enforces `source_character_id != target_character_id`.
    2. `trg_lws_character_relationships_same_sim`: Validates that source and target characters belong to the same simulation.
    3. `trg_lws_character_relationships_immutability`: Enforces immutability of `simulation_id`, `source_character_id`, and `target_character_id`.
    4. `trg_lws_character_relationships_no_delete`: Prohibits direct physical `DELETE` on relationships (requires soft-delete).
    5. `trg_lws_relationship_evidence_same_sim`: Validates that relationship, characters, and causal event belong to the same simulation.
    6. `trg_lws_relationship_evidence_no_update`: Prohibits direct updates on `lws_relationship_evidence`.
    7. `trg_lws_relationship_evidence_no_delete`: Prohibits direct physical `DELETE` on `lws_relationship_evidence`.
    8. `trg_lws_social_information_same_sim`: Validates that parent, root, originator, transmitter, recipient, and causal event belong to the simulation.
    9. `trg_lws_social_information_no_update`: Prohibits direct updates on `lws_social_information`.
    10. `trg_lws_social_information_no_delete`: Prohibits direct physical `DELETE` on `lws_social_information`.
    11. `trg_lws_character_faction_memberships_same_sim`: Validates that character belongs to simulation, and faction belongs to simulation's world.
    12. `trg_lws_character_faction_memberships_immutability`: Enforces immutability of `simulation_id`, `simulation_character_id`, and `faction_id`.
    13. `trg_lws_character_faction_memberships_no_delete`: Prohibits direct physical `DELETE` on faction memberships.
    14. `trg_lws_character_development_records_no_update`: Prohibits direct updates on `lws_character_development_records`.
    15. `trg_lws_character_development_records_no_delete`: Prohibits direct physical `DELETE` on `lws_character_development_records`.
  - Exactly 10 new indexes (41 cumulative across Phase 4–8 tables):
    1. `idx_lws_rel_unique_directional`: Unique index on `lws_character_relationships(simulation_id, source_character_id, target_character_id) WHERE deleted_at IS NULL`.
    2. `idx_lws_rel_source`: Index on `lws_character_relationships(simulation_id, source_character_id)`.
    3. `idx_lws_rel_target`: Index on `lws_character_relationships(simulation_id, target_character_id)`.
    4. `idx_lws_rel_evidence_rel`: Index on `lws_relationship_evidence(relationship_id, fictional_time DESC)`.
    5. `idx_lws_rel_evidence_sim_time`: Index on `lws_relationship_evidence(simulation_id, fictional_time DESC)`.
    6. `idx_lws_social_info_sim_subj`: Index on `lws_social_information(simulation_id, subject_key)`.
    7. `idx_lws_social_info_tree`: Index on `lws_social_information(root_social_information_id, parent_social_information_id)`.
    8. `idx_lws_faction_mem_unique`: Partial unique index on `lws_character_faction_memberships(simulation_id, simulation_character_id, faction_id) WHERE deleted_at IS NULL`.
    9. `idx_lws_faction_mem_char`: Index on `lws_character_faction_memberships(simulation_id, simulation_character_id)`.
    10. `idx_lws_dev_records_char_time`: Index on `lws_character_development_records(simulation_character_id, fictional_time DESC)`.
  - Cumulative database inventory: Exactly 31 tables (1 Phase 1 table `lws_meta` + 9 Phase 2 tables + 2 Phase 3 tables + 2 Phase 4 tables + 2 Phase 5 tables + 5 Phase 6 tables + 5 Phase 7 tables + 5 Phase 8 tables = 31 total tables), exactly 70 triggers on Phase 4–8 tables (80 triggers system-wide), and exactly 41 indexes on Phase 4–8 tables.
  - Event-backed state transitions: All social and character development mutations execute strictly via `COMMUNICATE`, `UPDATE_RUNTIME_STATE`, `DIRECTOR_MODIFY_STATE`, `COMBAT_ACTION`, `TRANSFER_ITEM`, and `TIME_ADVANCE`.
  - Pure in-memory zero-SQL replay engine expanded to fold all Phase 8 social and development state transitions with 100% tested field-level parity for relationships, evidence, social information, faction memberships, development records, and subjective beliefs against SQLite database state.



