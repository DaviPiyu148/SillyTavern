# ADR-017: Living World, Population Tiers, Environmental Dynamics, Operational States, and Emergence

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 9)

## Context

A believable, scalable living world cannot simulate every entity with full deliberative cognitive overhead, nor can it treat the world as a static background of empty rooms. Prior phases established:
- Authored models and simulation instances (Phases 1–3, ADR-011).
- The authoritative event ledger, state transition engine, and closed 29-event taxonomy (Phase 4, ADR-012).
- Temporal progression, 6-tier routine arbitration, and travel (Phase 5, ADR-013).
- Spatial perception, subjective knowledge, episodic memory, and perspective isolation (Phase 6, ADR-014).
- Autonomous cognition, goals, needs, values, emotions, and decision deliberation (Phase 7, ADR-015).
- Social systems, asymmetric relationships, rumors, factions, and causal development (Phase 8, ADR-016).

Phase 9 completes the systemic living world layer:
1. **Core Invariant:** $\mathbf{LLM\ proposes.\ Simulation\ Engine\ decides.\ Database\ records\ reality.\ Narrative\ presents\ reality.}$
2. **Closed 29-Event Taxonomy:** Zero new event types introduced. All environmental and population mutations project through existing canonical event types (`UPDATE_RUNTIME_STATE`, `DIRECTOR_MODIFY_STATE`, `TIME_ADVANCE`, and `CHARACTER_JOIN`).
3. **Tri-Tier Population Architecture:** Clear separation of Core (full deliberative cognition), Supporting (lightweight reactive cognition), and Ambient (ephemeral, zero-DB procedural presence) characters.
4. **Deterministic Ephemeral Presence:** Ambient entities are generated deterministically on-demand via seed-based pseudo-random generators without persisting rows to SQLite until/unless promoted.
5. **Causal Promotion Pipeline:** Ambient entities are promoted to Supporting tier via verifiable antecedent events or explicit Director action, creating authored snapshots, committing an atomic `CHARACTER_JOIN`, and logging immutable promotion provenance.
6. **Environmental Influence on Perception & Movement:** Lighting, crowd density, noise, air quality, and operational states dynamically modulate sensory clarity ($0..100$) and travel speed / path accessibility.
7. **Zero-SQL Pure Replay Parity:** Complete field-level in-memory reconstruction across all 20 simulation runtime tables and structures across 21 verification comparison steps.

---

## Decision

### 1. Database Schema Migration (009_environment_and_population)

Phase 9 establishes Migration 009 (`PRAGMA user_version = 9`), introducing 5 dedicated tables, 15 database triggers, and 10 indexes:

1. **`lws_location_environments`**:
   - Location-specific environmental conditions: `weather` (`clear`, `partly_cloudy`, `overcast`, `fog`, `rain`, `heavy_rain`, `storm`, `snow`, `blizzard`, `heatwave`), `temperature_baseline` ($-50.0..60.0$), `temperature_celsius` ($-50.0..60.0$), `temperature_override`, `lighting_level` (`pitch_black`, `dim`, `normal`, `bright`, `blinding`), `lighting_override`, `noise_level` ($0..100$), `is_indoor` ($0, 1$), `air_quality` (`clean`, `hazy`, `smoke`, `toxic`), `hazards` (JSON array), `last_evaluated_fictional_time`.
   - Mutation and deletion protected by triggers (`trg_lws_loc_env_same_sim`, `trg_lws_loc_env_immutability`, `trg_lws_loc_env_no_delete`, `trg_lws_loc_env_unique`).

2. **`lws_location_operational_states`**:
   - Dynamic location operational statuses: `access_status` (`open`, `closed`, `restricted`, `barricaded`, `abandoned`), `access_override`, `operating_hours` (JSON), `crowd_density` (`empty`, `sparse`, `moderate`, `crowded`, `packed`), `ambient_capacity` ($0..1000$).
   - Protected by triggers (`trg_lws_loc_ops_same_sim`, `trg_lws_loc_ops_immutability`, `trg_lws_loc_ops_no_delete`, `trg_lws_loc_ops_unique`).

3. **`lws_ambient_archetypes`**:
   - World-level authored templates for procedural ambient generation: `archetype_key`, `entity_kind` (`person`, `vehicle`, `creature`, `crowd`), `role_title`, `name_pool` (JSON array), `description_template`, `default_activities` (JSON array), `location_tags` (JSON array), `time_windows` (JSON array), `weather_compat` (JSON), `spawn_weight` ($1..100$), `max_concurrent_instances` ($\ge 1$).
   - Soft-delete protected by trigger `trg_lws_ambient_archetypes_no_delete`.

4. **`lws_simulation_character_tiers`**:
   - Authoritative classification of simulation characters: `tier` (`core`, `supporting`), `cognitive_budget` (`full`, `lightweight`), `is_promoted` ($0$ or $1$).
   - Default tier for instantiated characters is `core`; promoted characters default to `supporting`.
   - Protected by triggers (`trg_lws_char_tiers_same_sim`, `trg_lws_char_tiers_immutability`, `trg_lws_char_tiers_no_delete`).

5. **`lws_promoted_entity_records`**:
   - Immutable causal ledger tracking the promotion of ephemeral ambient entities to persistent simulation characters: `simulation_character_id`, `source_archetype_key`, `source_transient_id`, `origin_location_id`, `promotion_reason` (`direct_interaction`, `causal_event_witness`, `director_intervention`), `causal_event_id`, `promoted_to_tier` (`supporting`, `core`), `fictional_time`.
   - Protected by immutable update and deletion triggers (`trg_lws_promoted_records_same_sim`, `trg_lws_promoted_records_no_update`, `trg_lws_promoted_records_no_delete`).

---

## 2. Tri-Tier Population Model

- **Core Tier:** Full cognitive stack (Phases 6–8). Characters possess goals, intentions, full deliberative decision arbitration, memory formation, value systems, and relationship matrices. All state changes are persisted in SQLite.
- **Supporting Tier:** Lightweight cognitive budget. Need decay operates along canonical Phase 7 dimensions (`energy`, `nourishment`, `social`, `safety`, `morale`). Reactive action/dialogue selection is supported, but autonomous long-term goal generation and intensive planning loops are suppressed to conserve computation. State changes persist in SQLite.
- **Ambient Tier:** Ephemeral crowd entities. Zero persistent SQLite footprint. Generated deterministically for camera viewports via `generateAmbientPopulation(simLwsId, locLwsId, timeBucket, worldId, environment, operationalState, archetypes, activeSimCharacters)` using a combination of:
  - World ID and Simulation ID
  - Location ID and environmental profile (lighting, weather, crowd density, ambient capacity)
  - Fictional 1-hour time bucket (integer `floor(epoch_seconds / 3600)` resolved to time window)
  - Authored archetypes filtered by tags, time windows, and operational access status.
  - Ephemeral transient IDs follow the canonical 5-part format: `amb:<simLwsId>:<locLwsId>:<timeBucket>:<slotIndex>`.
  - For backward compatibility, client prompt logging, and UI inspection tooling, `parseTransientId()` defensively accepts and normalizes both the canonical 5-part format and a 6-part format (`amb:<simLwsId>:<locLwsId>:<timeBucket>:<archetypeKey>:<slotIndex>`), while only the 5-part form is generated and authoritative for simulation state.

---

## 3. Dynamic Entity Promotion Pipeline

When an ambient entity becomes significant through direct interaction or director intervention, it transitions to persistent reality via a deterministic 4-step pipeline:

1. **Proof of Existence:** The transient ID is verified against the deterministic generator using `validateTransientIdExistence(db, simId, transientId, fictionalTime)` (with the full input set) to prove the ambient entity was legitimately generated at that time and place.
2. **Authored Definition Creation:** An authored `lws_characters` row is created with snapshot traits derived from the source archetype.
3. **Atomic Event Execution:** A `CHARACTER_JOIN` event is committed to the simulation ledger with a structured `promotion` payload, atomically creating the `lws_simulation_characters` runtime row and establishing `causal_event_id` pointing to the antecedent event.
4. **Provenance Recording:** An immutable record is inserted into `lws_promoted_entity_records` linking the new simulation character to its antecedent transient ID, archetype key, origin location, causal event, and target tier (`supporting`).

---

## 4. Environmental Dynamics & Sensory Perception

- **Sensory Clarity Scoring:** Calculated dynamically from ambient environmental parameters:
  - Lighting penalty: `pitch_black` (-50), `dim` (-20), `blinding` (-30).
  - Noise penalty: `noise_level / 2`.
  - Air quality penalty: `dusty` (-10), `smoke`/`smoky` (-25), `toxic` (-40).
  - Crowd density penalty: `dense`/`crowded` (-10), `packed` (-20).
  $$\text{Clarity} = \text{clamp}(100 - \sum \text{penalties}, 0, 100)$$
- **Observation & Rumor Impact:** Sensory clarity scales the certainty and veracity of observations and increases the probability of rumor distortion during verbal transmission in compromised environments.
- **Operational States & Movement:** Operational states (`restricted`, `hazard`, `lockdown`, `barricaded`, `abandoned`) apply movement speed modifiers and restrict pathfinding for unauthorized character tiers.

---

## 5. Zero-SQL Pure Replay Parity

The pure in-memory replay engine (`src/living-world/events/replay.js`) folds events deterministically using `simulationReducer` with zero SQL queries. Complete field-level parity between replayed in-memory state and SQLite database state is verified by `verifySimulationParity()` across **21 comparison steps** covering root simulation state and **20 simulation runtime tables/structures**:

### A. Pre-Existing Cross-Phase Runtime State (Phases 1–8)
1. **Root Simulation State** (`lws_simulations`: status, current_fictional_time, settings, deleted_at)
2. **Simulation Characters** (`lws_simulation_characters`: location, activity, physical condition, runtime_state, authored_snapshot, deleted_at)
3. **Character Routines** (`lws_simulation_character_routines`: block_id, day_of_week, start_time, end_time, activity, target_location)
4. **Scheduled Events** (`lws_scheduled_events`: status, scheduled_fictional_time, title, location, supersedes/superseded_by, trigger/cancel)
5. **Simulation Cameras** (`lws_simulation_cameras`: camera_name, mode, target_character, target_location)
6. **Character Needs** (`lws_character_needs`: 5 canonical dimensions — `energy`, `nourishment`, `social`, `safety`, `morale`)
7. **Character Values** (`lws_character_values`: dimension, strength)
8. **Character Emotions** (`lws_character_emotions`: dominant_emotion, intensity, arousal, valence)
9. **Character Intentions** (`lws_character_intentions`: action_type, status, target, priority, failure/cancellation reason)
10. **Character Goals** (`lws_character_goals`: title, status, priority, urgency, progress, goal_type, deleted_at)
11. **Character Relationships** (`lws_character_relationships`: trust, affection, familiarity, respect, loyalty, last_interaction)
12. **Relationship Evidence** (`lws_relationship_evidence`: count and provenance)
13. **Social Information / Rumor Trees** (`lws_social_information`: transmission_depth, veracity, confidence_score, claim_statement)
14. **Faction Memberships** (`lws_character_faction_memberships`: rank_role, standing, loyalty_score, membership_status)
15. **Character Development Records** (`lws_character_development_records`: count and causality)
16. **Subjective Beliefs** (`lws_character_beliefs`: subject_key, statement, confidence)

### B. Phase 9 Runtime Additions (4 Tables)
17. **Character Tiers** (`lws_simulation_character_tiers`: tier, cognitive_budget, is_promoted)
18. **Promoted Entity Records** (`lws_promoted_entity_records`: source_archetype_key, source_transient_id, promotion_reason, promoted_to_tier)
19. **Location Environments** (`lws_location_environments`: weather, temperature_override, lighting_override, noise_level, air_quality)
20. **Location Operational States** (`lws_location_operational_states`: access_status, access_override, crowd_density, ambient_capacity)

Replay guarantees identical state reconstruction from cold event logs without issuing SQL queries during replay reduction.

---

## 6. Tri-Tier REST API & Security

- **Observer Endpoints:** Public/read-only access to location environment, operational status, ambient crowd estimates, and promoted entity records.
- **Subjective Endpoints:** Perspective-filtered environment sensing and character tier queries.
- **Director Endpoints:** Admin-authenticated endpoints for managing environmental profiles, operational state overrides, archetype catalogs, and ambient entity promotion.

---

## Consequences

- Scalable world simulation with rich crowds and dynamic environmental atmosphere at zero continuous database bloat.
- Seamless, causal promotion of ephemeral background characters into fully realized, persistent actors.
- Realistic environmental modulation of sensory perception, travel speed, and location accessibility.
- 100% deterministic auditability and event replay across all environmental and population systems.
