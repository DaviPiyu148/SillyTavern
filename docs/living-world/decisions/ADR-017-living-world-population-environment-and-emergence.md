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
2. **Closed 29-Event Taxonomy:** Zero new event types introduced. All environmental and population mutations project through existing event types (`ENVIRONMENT_CHANGE`, `LOCATION_STATUS_CHANGE`, `CHARACTER_JOIN`, `UPDATE_RUNTIME_STATE`, `DIRECTOR_MODIFY_STATE`, `TIME_ADVANCE`, etc.).
3. **Tri-Tier Population Architecture:** Clear separation of Core (full deliberative cognition), Supporting (lightweight reactive cognition), and Ambient (ephemeral, zero-DB procedural presence) characters.
4. **Deterministic Ephemeral Presence:** Ambient entities are generated deterministically on-demand via seed-based pseudo-random generators without persisting rows to SQLite until/unless promoted.
5. **Causal Promotion Pipeline:** Ambient entities are promoted to Supporting tier via verifiable antecedent events or explicit Director action, creating authored snapshots, committing an atomic `CHARACTER_JOIN`, and logging immutable promotion provenance.
6. **Environmental Influence on Perception & Movement:** Lighting, crowd density, noise, air quality, and operational states dynamically modulate sensory clarity ($0..100$) and travel speed / path accessibility.
7. **Zero-SQL Pure Replay Parity:** Complete field-level in-memory reconstruction across all 14 authoritative simulation tables.

---

## Decision

### 1. Database Schema Migration (009_environment_and_population)

Phase 9 establishes Migration 009 (`PRAGMA user_version = 9`), introducing 5 dedicated tables, 15 database triggers, and 10 indexes:

1. **`lws_location_environmental_profiles`**:
   - Location-specific environmental conditions: `lighting_level` (`pitch_black`, `dim`, `normal`, `bright`, `blinding`), `crowd_density` (`empty`, `sparse`, `moderate`, `dense`, `packed`), `noise_level` $[0, 100]$, `air_quality` (`clean`, `dusty`, `smoky`, `toxic`, `unbreathable`), `ambient_capacity` (integer), `last_updated_fictional_time`.
   - Mutation and deletion protected by triggers.

2. **`lws_location_operational_states`**:
   - Dynamic location operational statuses: `operational_state` (`normal`, `restricted`, `hazard`, `lockdown`, `festivity`, `evacuated`, `custom`), `accessibility` (`open`, `permit_only`, `staff_only`, `closed`, `quarantine`), `movement_speed_modifier` $[0.1, 2.0]$, `danger_level` $[0, 100]$, `reason`, `active_since_fictional_time`.
   - Immutable audit history and active-state tracking.

3. **`lws_ambient_population_archetypes`**:
   - World-level authored templates for procedural ambient generation: `archetype_key`, `name`, `description`, `roles` (JSON array), `weight` (integer $[1, 1000]$), `location_filter_tags` (JSON array), `time_filter_buckets` (JSON array).
   - Uniqueness enforced per world.

4. **`lws_simulation_character_tiers`**:
   - Authoritative classification of simulation characters: `tier` (`core`, `supporting`), `cognitive_budget` (`full`, `lightweight`), `is_promoted` ($0$ or $1$), `assigned_fictional_time`.
   - Default tier for instantiated characters is `core`; promoted characters default to `supporting`.

5. **`lws_promoted_entities`**:
   - Immutable causal ledger tracking the promotion of ephemeral ambient entities to persistent simulation characters: `simulation_character_id`, `source_transient_id`, `source_archetype_key`, `promotion_reason` (`direct_interaction`, `story_significance`, `repeated_relevance`, `director_intervention`), `causal_event_id`, `promoted_to_tier` (`supporting`, `core`), `promoted_at_fictional_time`.
   - Protected by immutable update trigger `trg_lws_promoted_entities_no_update`.

---

## 2. Tri-Tier Population Model

- **Core Tier:** Full cognitive stack (Phases 6–8). Characters possess goals, intentions, full deliberative decision arbitration, memory formation, value systems, and relationship matrices. All state changes are persisted in SQLite.
- **Supporting Tier:** Lightweight cognitive budget. Need decay operates along canonical Phase 7 dimensions (`energy`, `nourishment`, `social`, `safety`, `morale`). Reactive action/dialogue selection is supported, but autonomous long-term goal generation and intensive planning loops are suppressed to conserve computation. State changes persist in SQLite.
- **Ambient Tier:** Ephemeral crowd entities. Zero persistent SQLite footprint. Generated deterministically for camera viewports via `generateAmbientPopulation()` using a combination of:
  - World ID and Simulation ID
  - Location ID and environmental profile (crowd density, ambient capacity)
  - Fictional time bucket (`dawn`, `morning`, `afternoon`, `evening`, `night`, `late_night`)
  - Authored archetypes filtered by tags and operational state.
  - Ephemeral transient IDs follow the canonical schema: `amb:{simLwsId}:{locLwsId}:{timeBucket}:{archetypeKey}:{index}`.

---

## 3. Dynamic Entity Promotion Pipeline

When an ambient entity becomes significant through direct interaction or director intervention, it transitions to persistent reality via a deterministic 4-step pipeline:

1. **Proof of Existence:** The transient ID is verified against the deterministic generator using `validateTransientIdExistence(db, simId, transientId, fictionalTime)` to prove the ambient entity was legitimately generated at that time and place.
2. **Authored Definition Creation:** An authored `lws_characters` row is created with snapshot traits derived from the source archetype.
3. **Atomic Event Execution:** A `CHARACTER_JOIN` event is committed to the simulation ledger with a structured `promotion` payload, atomically creating the `lws_simulation_characters` runtime row.
4. **Provenance Recording:** An immutable record is inserted into `lws_promoted_entities` linking the new simulation character to its antecedent transient ID, archetype key, causal event, and target tier (`supporting`).

---

## 4. Environmental Dynamics & Sensory Perception

- **Sensory Clarity Scoring:** Calculated dynamically from ambient environmental parameters:
  - Lighting penalty: `pitch_black` (-50), `dim` (-20), `blinding` (-30).
  - Noise penalty: `noise_level / 2`.
  - Air quality penalty: `dusty` (-10), `smoky` (-25), `toxic` (-40), `unbreathable` (-50).
  - Crowd density penalty: `dense` (-10), `packed` (-20).
  $$\text{Clarity} = \text{clamp}(100 - \sum \text{penalties}, 0, 100)$$
- **Observation & Rumor Impact:** Sensory clarity scales the certainty and veracity of observations and increases the probability of rumor distortion during verbal transmission in compromised environments.
- **Operational States & Movement:** Operational states (`restricted`, `hazard`, `lockdown`, `evacuated`) apply movement speed multipliers ($0.1$ to $2.0$) and restrict pathfinding for unauthorized character tiers.

---

## 5. Zero-SQL Pure Replay Parity

All 14 simulation runtime tables are fully supported by pure in-memory replay (`src/living-world/events/replay.js`):
1. `lws_simulations`
2. `lws_simulation_characters`
3. `lws_locations` (runtime overrides)
4. `lws_items`
5. `lws_character_beliefs`
6. `lws_character_goals`
7. `lws_character_intentions`
8. `lws_character_values`
9. `lws_character_needs`
10. `lws_character_emotions`
11. `lws_character_relationships`
12. `lws_character_faction_memberships`
13. `lws_location_environmental_profiles`
14. `lws_location_operational_states`
15. `lws_simulation_character_tiers`
16. `lws_promoted_entities`

Replay guarantees identical state reconstruction from cold event logs without issuing SQL queries.

---

## 6. Tri-Tier REST API & Security

- **Observer Endpoints:** Public/read-only access to location environment, operational status, and ambient crowd estimates.
- **Subjective Endpoints:** Perspective-filtered environment sensing and character tier queries.
- **Director Endpoints:** Admin-authenticated endpoints for managing environmental profiles, operational state overrides, archetype catalogs, and ambient entity promotion.

---

## Consequences

- Scalable world simulation with rich crowds and dynamic environmental atmosphere at zero continuous database bloat.
- Seamless, causal promotion of ephemeral background characters into fully realized, persistent actors.
- Realistic environmental modulation of sensory perception, travel speed, and location accessibility.
- 100% deterministic auditability and event replay across all environmental and population systems.
