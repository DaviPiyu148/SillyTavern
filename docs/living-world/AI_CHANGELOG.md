# AI Changelog

This file records meaningful AI-agent changes to the LWS system.

## Format

```text
## YYYY-MM-DD — Change title

Status: IMPLEMENTED / VERIFIED / PARTIAL / BLOCKED

### Change
What changed.

### Reason
Why it changed.

### Files/modules
Affected areas.

### Architecture
Boundary or contract impact.

### Tests
Tests/checks and result.

### Notes
Known limitations or implications.
```

---

## 2026-09-26 — Phase 9: Living World, Population, Environment, and Emergence

Status: IMPLEMENTED / VERIFIED

### Change
Implemented authoritative living world simulation features: location environments, location operational states, world-authored ambient population archetypes, procedural seed-based ephemeral ambient generation with collision-proof transient IDs, causal entity promotion pipeline, population tier classification (Core, Supporting, Ambient) with cognitive budgeting, sensory clarity calculation ($0..100$) and travel modifiers, pure zero-SQL replay engine parity across all 20 simulation runtime tables/structures (21 verification steps), and tri-tier REST transport:

1. Created database migration `009_environment_and_population.js` elevating schema version to `PRAGMA user_version = 9`:
   - Exactly 5 new tables: `lws_location_environments`, `lws_location_operational_states`, `lws_ambient_archetypes`, `lws_simulation_character_tiers`, `lws_promoted_entity_records`.
   - Exactly 15 Phase 9 triggers (85 cumulative across Phase 4–9 tables, 95 cumulative across all tables):
     1. `trg_lws_loc_env_same_sim`: Validates location belongs to simulation's world on environment insertion.
     2. `trg_lws_loc_env_immutability`: Blocks mutating `lws_id`, `simulation_id`, and `location_id` on environments.
     3. `trg_lws_loc_env_no_delete`: Prohibits direct physical `DELETE` on `lws_location_environments`.
     4. `trg_lws_loc_ops_same_sim`: Validates location belongs to simulation's world on operational state insertion.
     5. `trg_lws_loc_ops_immutability`: Blocks mutating `lws_id`, `simulation_id`, and `location_id` on operational states.
     6. `trg_lws_loc_ops_no_delete`: Prohibits direct physical `DELETE` on `lws_location_operational_states`.
     7. `trg_lws_ambient_archetypes_no_delete`: Prohibits direct physical `DELETE` on `lws_ambient_archetypes` (requires soft-delete).
     8. `trg_lws_promoted_records_same_sim`: Validates character, origin location, and causal event belong to simulation on promotion insertion.
     9. `trg_lws_promoted_records_no_update`: Prohibits `UPDATE` on immutable `lws_promoted_entity_records`.
     10. `trg_lws_promoted_records_no_delete`: Prohibits direct physical `DELETE` on `lws_promoted_entity_records`.
     11. `trg_lws_char_tiers_same_sim`: Validates character belongs to simulation on character tier insertion.
     12. `trg_lws_char_tiers_immutability`: Blocks mutating `lws_id`, `simulation_id`, and `simulation_character_id` on character tiers.
     13. `trg_lws_char_tiers_no_delete`: Prohibits direct physical `DELETE` on `lws_simulation_character_tiers`.
     14. `trg_lws_loc_env_unique`: Prevents duplicate environment rows per simulation and location.
     15. `trg_lws_loc_ops_unique`: Prevents duplicate operational state rows per simulation and location.
   - Exactly 10 new indexes (51 cumulative across Phase 4–9 tables):
     1. `idx_lws_loc_env_sim_loc`: Unique index on `lws_location_environments(simulation_id, location_id)`.
     2. `idx_lws_loc_ops_sim_loc`: Unique index on `lws_location_operational_states(simulation_id, location_id)`.
     3. `idx_lws_ambient_archetypes_world_key`: Unique index on `lws_ambient_archetypes(world_id, archetype_key) WHERE deleted_at IS NULL`.
     4. `idx_lws_ambient_archetypes_world_tags`: Index on `lws_ambient_archetypes(world_id, entity_kind) WHERE deleted_at IS NULL`.
     5. `idx_lws_promoted_records_sim_char`: Index on `lws_promoted_entity_records(simulation_id, simulation_character_id)`.
     6. `idx_lws_promoted_records_sim_time`: Index on `lws_promoted_entity_records(simulation_id, fictional_time DESC)`.
     7. `idx_lws_promoted_transient_unique`: Unique index on `lws_promoted_entity_records(simulation_id, source_transient_id)`.
     8. `idx_lws_char_tiers_sim_char`: Unique index on `lws_simulation_character_tiers(simulation_id, simulation_character_id)`.
     9. `idx_lws_char_tiers_sim_tier`: Index on `lws_simulation_character_tiers(simulation_id, tier)`.
     10. `idx_lws_loc_env_weather`: Index on `lws_location_environments(simulation_id, weather)`.
   - Cumulative database inventory: Exactly 36 tables, 85 triggers on Phase 4–9 tables (95 triggers system-wide), 51 indexes on Phase 4–9 tables.

2. Implemented 8 Environment & Population Modules:
   - `src/living-world/environment/common.js`: Environmental taxonomies (`lighting_level`, `crowd_density`, `noise_level`, `air_quality`, `access_status`), sensory clarity scoring formula, and travel speed modifier calculations.
   - `src/living-world/environment/environment.js`: Environmental profiles CRUD, validation, and event-backed mutations.
   - `src/living-world/environment/operational-states.js`: Operational states management, accessibility validation, and event-backed mutations.
   - `src/living-world/population/common.js`: Population tier taxonomies (`core`, `supporting`, `ambient`), canonical 5-part transient ID formatting (`amb:<sim>:<loc>:<bucket>:<slotIndex>`), defensive 6-part parsing support, and time bucket categorization.
   - `src/living-world/population/archetypes.js`: World-level authored ambient archetype CRUD and validation.
   - `src/living-world/population/ambient-generator.js`: Deterministic seed-based pseudo-random generator producing plausible ambient crowd members on-demand for viewport cameras.
   - `src/living-world/population/promotion.js`: Dynamic entity promotion pipeline with transient ID proof-of-existence verification and immutable promotion ledger logging.
   - `src/living-world/population/character-tiers.js`: Character tier tracking and cognitive budget arbitration (Core: full; Supporting: lightweight; Ambient: zero-DB).

3. Pure Zero-SQL Replay & Parity Engine (`src/living-world/events/replay.js`):
   - `simulationReducer` reconstructs all Phase 9 environments, operational states, character tiers, and promoted entity records in pure memory with zero SQL queries.
   - `verifySimulationParity` proves 100% tested field-level parity across all 20 simulation runtime tables/structures (21 verification steps).

4. Mounted 12 Tri-Tier REST Endpoints in `src/endpoints/living-world.js`:
   - Observer Tier:
     - `GET /api/living-world/simulations/:simLwsId/locations/:locLwsId/environment`
     - `GET /api/living-world/simulations/:simLwsId/locations/:locLwsId/operational-state`
     - `GET /api/living-world/simulations/:simLwsId/locations/:locLwsId/ambient-population`
     - `GET /api/living-world/simulations/:simLwsId/promoted-entities`
   - Subjective Character Tier:
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/environment-perception`
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/tier`
   - Director Tier:
     - `POST /api/living-world/simulations/:simLwsId/locations/:locLwsId/environment`
     - `POST /api/living-world/simulations/:simLwsId/locations/:locLwsId/operational-state`
     - `POST /api/living-world/worlds/:worldLwsId/ambient-archetypes`
     - `GET /api/living-world/worlds/:worldLwsId/ambient-archetypes`
     - `PATCH /api/living-world/worlds/:worldLwsId/ambient-archetypes/:archetypeLwsId`
     - `POST /api/living-world/simulations/:simLwsId/promote-entity`

### Reason
Fulfill LWS Phase 9 specifications to provide dynamic, atmospheric world presence and background crowds without combinatorial cognitive overhead or database bloat.

### Files/modules
- `src/living-world/migrations/009_environment_and_population.js`
- `src/living-world/migrations/index.js`
- `src/living-world/environment/` (`common.js`, `environment.js`, `operational-states.js`)
- `src/living-world/population/` (`common.js`, `archetypes.js`, `ambient-generator.js`, `promotion.js`, `character-tiers.js`)
- `src/living-world/events/replay.js`
- `src/living-world/events/events.js`
- `src/endpoints/living-world.js`
- `src/living-world/index.js`
- `tests/living-world/` (9 new Phase 9 test suites)
- `docs/living-world/decisions/ADR-017-living-world-population-environment-and-emergence.md`

### Architecture
- Maintained One Authoritative Path: all mutations route through `commitEvent()`.
- Bounded cognitive overhead: Core vs Supporting cognitive budgeting.
- Zero-DB ephemeral generation: Ambient entities generated deterministically from seed without persistent storage.
- Causal promotion: Ephemeral entities promoted with verifiable antecedent events and immutable provenance.
- Pure in-memory replay parity across all 20 simulation runtime tables/structures (21 verification steps).

### Tests
- 9 dedicated Phase 9 test suites passing (37/37 tests).
- All 63 Living World test suites passing (437/437 tests).
- All 82 SillyTavern repository test suites passing (848/848 tests, 0 failures).

### Notes
Phase 9 complete, verified, and accepted. Next phase: Phase 10 (Prompt, Context, and SillyTavern Generation Integration).

---

## 2026-09-26 — Phase 8: Social Systems, Dynamic Relationships, Rumors, Factions, and Character Development

Status: IMPLEMENTED / VERIFIED

### Change
Implemented authoritative social systems, dynamic directed relationships with exponential familiarity decay, causal relationship evidence, rumor propagation trees with strict topological integrity, runtime faction memberships and standing, causal character development with dual-store projection, extended multi-criteria social deliberation scoring, pure zero-SQL replay parity, and tri-tier REST transport for Living World Simulator (LWS):

1. Created database migration `008_social_and_development.js` elevating schema version to `PRAGMA user_version = 8`:
   - Exactly 5 new tables: `lws_character_relationships`, `lws_relationship_evidence`, `lws_social_information`, `lws_character_faction_memberships`, `lws_character_development_records`.
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
   - Cumulative database inventory: Exactly 31 tables, 70 triggers on Phase 4–8 tables (80 triggers system-wide), 41 indexes on Phase 4–8 tables.

2. Implemented 6 Social & Development Modules under `src/living-world/social/`:
   - `common.js`: UUID validation, bounds checks, timestamp helpers, exponential decay helpers ($F(t) = \text{round}(F_0 \cdot e^{-(t - 7\text{d})/\tau})$, $\tau = 30\,\text{d}$), and taxonomy validations for 5 canonical relationship dimensions (`trust`, `affection`, `familiarity`, `respect`, `loyalty`).
   - `relationships.js`: Directed dynamic relationships (trust, affection, respect, familiarity, loyalty, last_interaction_fictional_time), decaying familiarity, and atomic updates.
   - `evidence.js`: Causal relationship evidence linked to authoritative simulation events (`delta_trust`, `delta_affection`, `delta_familiarity`, `delta_respect`, `delta_loyalty`, `interaction_type`, `narrative_rationale`).
   - `rumors.js`: Rumors, social claims, veracity, confidence, and propagation trees with strict 17-invariant topology enforcement (depth bounding $0..5$, root self-reference, parent-child depth $+1$, root lineage continuity, same-simulation membership). Includes subjective belief adoption on received claims.
   - `factions.js`: Runtime faction memberships, ranks, titles, standing ($[-100, 100]$), loyalty scores, and faction-authored to runtime snapshotting.
   - `development.js`: Causal character development records (`value_shift`, `baseline_need_shift`, `disposition_shift`, `habit_shift`), 5 trigger categories (`acute_trauma`, `sustained_experience`, `social_reinforcement`, `cognitive_dissonance`, `director_override`), and dual-store projection to runtime state and Phase 7 tables.

3. Extended Deliberation & Cognition Scoring (`src/living-world/cognition/deliberation.js`):
   - Added multi-criteria social utility scoring ($U_{\text{social}}$) evaluating relationship affection, trust, loyalty, respect, and faction alignment:
     $$U_{\text{action}} = 0.35 \cdot U_{\text{need}} + 0.30 \cdot U_{\text{goal}} + U_{\text{social}} + 0.20 \cdot A_{\text{val}} + 0.15 \cdot B_{\text{emo}} - \text{Penalties}$$
     where Pro-Social: $U_{\text{social}} = 0.35 \cdot \text{affection} + 0.35 \cdot \text{trust} + 0.20 \cdot \text{loyalty} + 0.10 \cdot \text{respect} + \text{sameFactionBonus}$
     and Hostile: $U_{\text{social}} = -0.40 \cdot \text{affection} - 0.40 \cdot \text{trust} - 0.20 \cdot \text{loyalty} - \text{sameFactionBonus}$
   - Strict moral veto precedence: Hard moral constraints ($\ge +75$) unconditionally veto prohibited candidate actions regardless of high social or need utility.

4. Pure Zero-SQL Replay & Parity Engine (`src/living-world/events/replay.js`):
   - `simulationReducer` reconstructs relationships, relationship evidence, social information, faction memberships, development records, and subjective beliefs in pure memory with zero SQL queries.
   - `verifySimulationParity` proves 100% tested field-level parity against SQLite database state across all Phase 8 tables.

5. Mounted Tri-Tier REST Endpoints in `src/endpoints/living-world.js`:
   - Observer Tier (Read-Only Ground Truth):
     - `GET /api/living-world/simulations/:simLwsId/social/graph`
     - `GET /api/living-world/simulations/:simLwsId/social-information`
     - `GET /api/living-world/simulations/:simLwsId/social-information/:infoLwsId/tree`
     - `GET /api/living-world/simulations/:simLwsId/faction-memberships`
   - Character-Subjective Tier (Filtered Perspective):
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships`
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId`
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId/evidence`
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/factions`
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/development`
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/known-rumors`
   - Director Tier (Authoritative State Mutations):
     - `POST /api/living-world/simulations/:simLwsId/social-interventions` (unified Director intervention endpoint executing validated `DIRECTOR_MODIFY_STATE` event-ledger transitions for relationships, rumors, factions, and development records)

6. Authored ADR-016 in `docs/living-world/decisions/ADR-016-social-systems-and-character-development.md`.

### Reason
Fulfill Phase 8 of the Living World Simulator roadmap: deliver social systems, dynamic relationships, rumor trees, runtime factions, causal character development, social deliberation scoring, zero-SQL replay, and tri-tier REST transport as a single atomic delivery unit.

### Files/modules
- Created:
  - `src/living-world/migrations/008_social_and_development.js`
  - `src/living-world/social/common.js`
  - `src/living-world/social/relationships.js`
  - `src/living-world/social/evidence.js`
  - `src/living-world/social/rumors.js`
  - `src/living-world/social/factions.js`
  - `src/living-world/social/development.js`
  - `tests/living-world/lws-social-db.test.js`
  - `tests/living-world/lws-relationships.test.js`
  - `tests/living-world/lws-rumors-information.test.js`
  - `tests/living-world/lws-character-development.test.js`
  - `tests/living-world/lws-factions-runtime.test.js`
  - `tests/living-world/lws-social-cognition.test.js`
  - `tests/living-world/lws-social-replay.test.js`
  - `tests/living-world/lws-social-api.test.js`
  - `docs/living-world/decisions/ADR-016-social-systems-and-character-development.md`
- Modified:
  - `src/living-world/migrations/index.js`
  - `src/living-world/events/taxonomy.js`
  - `src/living-world/events/events.js`
  - `src/living-world/events/state-transitions.js`
  - `src/living-world/events/replay.js`
  - `src/living-world/cognition/common.js`
  - `src/living-world/cognition/deliberation.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/PERSISTENCE.md`
  - `docs/living-world/ARCHITECTURE.md`
  - `docs/living-world/SECURITY.md`
  - `docs/living-world/DOCUMENTATION_INDEX.md`
  - `docs/living-world/AI_CHANGELOG.md`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-st-integration.test.js`

### Architecture
- Closed 29-event taxonomy preserved with zero additions.
- Database version advances to `PRAGMA user_version = 8` with 5 new tables, 15 triggers, and 10 indexes.
- Tri-tier authorization architecture strictly enforced across endpoints.
- Rumor transmission trees strictly bounded ($0..5$) with 17 topology invariants verified.
- Character development records require causal event lineage with dual-store projection to runtime state and Phase 7 tables.
- Pure zero-SQL in-memory replay verified with 100% field-level parity.

### Tests
- Dedicated Phase 8 test suites: 8 suites / 58 tests passing (including 17 rumor topology and 9 development causality tests).
- Cumulative LWS test suites: 54 suites / 400 tests passing (100% pass rate).
- Full repository unit test suite: 72 suites / 812 tests passing.

---

## 2026-09-26 — Phase 7: Character Cognition and Decision Making

Status: IMPLEMENTED / VERIFIED / ACCEPTED

### Change
Implemented autonomous character cognition, physiological/psychological need dynamics, goal lifecycles, intention tracking, personality values, emotional decay, internal deliberation, Tier 3 routine arbitration, pure zero-SQL replay, and REST transport for Living World Simulator (LWS):

1. Created database migration `007_cognition_and_decisions.js` elevating schema version to `PRAGMA user_version = 7`:
   - Exactly 5 new tables: `lws_character_needs`, `lws_character_goals`, `lws_character_intentions`, `lws_character_values`, `lws_character_emotions`.
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
   - Cumulative database inventory: Exactly 26 tables, 55 triggers on Phase 4–7 tables, 31 indexes.

2. Implemented 8 Cognition Modules under `src/living-world/cognition/`:
   - `common.js`: UUID validation, bounds checks, timestamp helpers, and common validation routines.
   - `needs.js`: Physiological and psychological needs (5 dimensions: `energy`, `nourishment`, `social`, `safety`, `morale` in $[0, 100]$), rates of change, acute deficit calculation ($< 20$). Includes retained domain helper `evaluateAcuteNeeds()` reachable only from Phase 7 tests.
   - `goals.js`: Hierarchical goal management (`proposed`, `active`, `suspended`, `completed`, `abandoned`), priority, urgency, and parent goal validations. 100% event-backed goal mutations via `UPDATE_RUNTIME_STATE` with automatic child intention cancellation upon entering terminal states (P0-1 correction).
   - `intentions.js`: Action commitments with dual sequence numbers (simulation sequence and per-character sequence), plan steps, and Option B failure state persistence via `UPDATE_RUNTIME_STATE`.
   - `values.js`: Personality values (6 dimensions: `honesty`, `courage`, `compassion`, `ambition`, `loyalty`, `curiosity` in $[-100, 100]$), weights, stability, and hard moral veto rule ($\ge +75$).
   - `emotions.js`: Emotional states with hyperbolic decay formula ($I(t) = \frac{I_0}{1 + \Delta t / \tau}$, $\tau = 14400\,\text{s}$).
   - `deliberation.js`: Multi-criteria deliberation engine computing composite action scores based on need satisfaction, value alignment, emotional congruence, and plan feasibility, subject to moral veto constraints.
   - `arbitration.js`: Six-tier routine arbitration activating Tier 3 `GOAL_PURSUIT` (`DIRECTOR_OVERRIDE` > `INTERRUPTED` > `GOAL_PURSUIT` > `TRAVEL` > `ROUTINE` > `IDLE`).

3. Replay and Parity Engine (`src/living-world/events/replay.js`):
   - `simulationReducer` handles all cognition state mutations in pure memory with zero SQL queries.
   - `verifySimulationParity` proves 100% tested field-level parity for the declared Phase 7 cognition state across all 5 cognition tables with zero drift.

4. Mounted Exact 9 REST Routes in `src/endpoints/living-world.js`:
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/needs`
   - `PATCH /api/living-world/simulations/:simLwsId/characters/:charLwsId/needs`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/goals`
   - `POST /api/living-world/simulations/:simLwsId/characters/:charLwsId/goals`
   - `PATCH /api/living-world/simulations/:simLwsId/characters/:charLwsId/goals/:goalLwsId`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/intentions`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/values`
   - `PATCH /api/living-world/simulations/:simLwsId/characters/:charLwsId/values`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/emotions`
   - Conforms strictly to contract without direct `DELETE /goals/:id` route; soft-deletion is performed via `PATCH /goals/:id` with `{ is_deleted: true }` (P0-2 contract closure).

5. Authored ADR-015 in `docs/living-world/decisions/ADR-015-character-cognition-and-decision-making.md`.

### Reason
Fulfill Phase 7 of the Living World Simulator roadmap: implement autonomous character cognition, need dynamics, goal lifecycles, intention tracking, personality values, emotional decay, internal deliberation, Tier 3 routine arbitration, pure zero-SQL replay, and REST transport.

### Historical Provenance & Git Lineage
- **Phase 6 Accepted Parent**: `3e0d3279338561040cfc44ed06fb522cf8116afe`
- **Phase 7 Initial Implementation**: `e1709ce9ca17e44c592811a255e99de41263e009`
- **Phase 7 Final Contract Closure**: `f2212206a37d01885ac97cf538060fdcedfb14b1` (resolved P0-1 direct-SQL goal mutations and P0-2 contract closure removing extraneous DELETE route)

### Files/modules
- Created:
  - `src/living-world/migrations/007_cognition_and_decisions.js`
  - `src/living-world/cognition/arbitration.js`
  - `src/living-world/cognition/common.js`
  - `src/living-world/cognition/deliberation.js`
  - `src/living-world/cognition/emotions.js`
  - `src/living-world/cognition/goals.js`
  - `src/living-world/cognition/intentions.js`
  - `src/living-world/cognition/needs.js`
  - `src/living-world/cognition/values.js`
  - `tests/living-world/lws-cognition-db.test.js`
  - `tests/living-world/lws-needs.test.js`
  - `tests/living-world/lws-goals.test.js`
  - `tests/living-world/lws-intentions.test.js`
  - `tests/living-world/lws-values.test.js`
  - `tests/living-world/lws-emotions.test.js`
  - `tests/living-world/lws-deliberation.test.js`
  - `tests/living-world/lws-cognition-replay.test.js`
  - `docs/living-world/decisions/ADR-015-character-cognition-and-decision-making.md`
- Modified:
  - `src/living-world/migrations/index.js`
  - `src/living-world/events/state-transitions.js`
  - `src/living-world/events/replay.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/PERSISTENCE.md`
  - `docs/living-world/AI_CHANGELOG.md`
  - `docs/living-world/DOCUMENTATION_INDEX.md`
  - `docs/living-world/ARCHITECTURE.md`
  - `docs/living-world/SECURITY.md`

### Architecture
- Closed 29-event taxonomy preserved with zero additions.
- Database version advances to `PRAGMA user_version = 7` with 5 new tables, 15 triggers, and 10 indexes.
- 100% event-backed goal mutations via `UPDATE_RUNTIME_STATE`.
- Option B failed intention persistence.
- Pure zero-SQL replay with 100% tested field-level parity for declared Phase 7 cognition state.
- Exact 9 REST endpoints.

### Tests
- Dedicated Phase 7 test suites: 8 suites / 47 tests passing.
- Cumulative LWS test suites: 47 suites / 341 tests passing.
- Full repository unit test suite: 65 suites / 753 tests passing.
- ESLint checks passing cleanly with 0 errors across root and test directories.

### Notes
- Social systems, relationships, group dynamics, and emergent social hierarchy remain designed for Phase 8.

---

## 2026-09-24 — Phase 6: Perception, Knowledge, Memory, and Observation

Status: IMPLEMENTED / VERIFIED

### Change
Implemented authoritative character perception, subjective knowledge, memory formation with exponential decay retrieval, beliefs/suspicions, simulation camera perspectives, deterministic identity derivation, pure zero-SQL replay, and REST transport for Living World Simulator (LWS):

1. Created database migration `006_perception_and_knowledge.js` elevating schema version to `PRAGMA user_version = 6`:
   - Exactly 5 new tables: `lws_event_perceptions`, `lws_character_knowledge`, `lws_character_memories`, `lws_character_beliefs`, `lws_simulation_cameras`.
    - Exactly 15 Phase 6 triggers (39 cumulative across system):
      1. `trg_lws_perceptions_immutable`: Prohibits direct updates on `lws_event_perceptions`.
      2. `trg_lws_perceptions_no_delete`: Prohibits direct physical DELETE on `lws_event_perceptions`.
      3. `trg_lws_perceptions_same_sim`: Validates event and character belong to perception simulation.
      4. `trg_lws_knowledge_identity_immutable`: Enforces immutability of simulation_id and simulation_character_id on knowledge.
      5. `trg_lws_knowledge_insert_integrity`: Validates character, source character, and source event belong to simulation on knowledge insertion.
      6. `trg_lws_knowledge_no_delete`: Prohibits direct physical DELETE on knowledge (requires soft-delete).
      7. `trg_lws_memories_identity_immutable`: Enforces immutability of simulation_id and simulation_character_id on memories.
      8. `trg_lws_memories_insert_integrity`: Validates character and event reference belong to simulation on memory insertion.
      9. `trg_lws_memories_no_delete`: Prohibits direct physical DELETE on memories (requires soft-delete).
      10. `trg_lws_beliefs_identity_immutable`: Enforces immutability of simulation_id and simulation_character_id on beliefs.
      11. `trg_lws_beliefs_insert_integrity`: Validates character and causal event reference belong to simulation on belief insertion.
      12. `trg_lws_beliefs_no_delete`: Prohibits direct physical DELETE on beliefs (requires soft-delete).
      13. `trg_lws_cameras_identity_immutable`: Enforces immutability of simulation_id and camera_name on `lws_simulation_cameras`.
      14. `trg_lws_cameras_insert_integrity`: Validates mode/target invariants and cross-simulation lineage on camera insertion.
      15. `trg_lws_cameras_update_integrity`: Validates mode/target invariants and cross-simulation lineage on camera update.
    - Exactly 10 new indexes: `idx_lws_perceptions_event`, `idx_lws_perceptions_char_time`, `idx_lws_knowledge_char_lookup`, `idx_lws_knowledge_sim_char`, `idx_lws_memories_char_time`, `idx_lws_memories_char_salience`, `idx_lws_memories_sim_char`, `idx_lws_beliefs_lookup`, `idx_lws_beliefs_sim_char`, `idx_lws_cameras_sim`.
   - Cumulative database inventory: Exactly 21 tables, 39 triggers on Phase 4–6 tables, 21 indexes.

2. Implemented Spatial Sensory Perception Engine (`src/living-world/perception/spatial.js`, `perceptions.js`):
   - Hierarchical tree LCA distance calculation evaluating physical reachability across tree hierarchy.
   - Option A canonical modality precedence: $\text{tactile} > \text{visual} > \text{auditory} > \text{olfactory}$.
   - Strictly single-modality persistence per `(event, character)`; storage of `omniscience_director` strictly forbidden in `lws_event_perceptions`.
   - Atomic integration inside `internalCommitEvent`.

3. Implemented Subjective Knowledge & Causal Evidence (`src/living-world/perception/knowledge.js`):
   - Knowledge extraction from event payloads (`COMMUNICATE`, `OBSERVE`, `INTERACT_OBJECT`, `DIRECTOR_MODIFY_STATE`).
   - Strict preservation of causal provenance (`source_channel`, `source_character_id`, `source_event_id`, `fictional_time_acquired`).
   - Active filtering and soft-delete capabilities.

4. Implemented Character Memories & Relevance Retrieval (`src/living-world/perception/memories.js`, `memory-retrieval.js`):
   - Episodic, semantic, and backstory memory creation linked to causal events.
   - Candidate pre-filter bounded to $N \le 100$ records via index `idx_lws_memories_char_salience`.
   - Multi-factor relevance scoring with frozen 7-day recency decay ($\tau = 604800\,\text{s}$):
     $$S_{\text{total}} = 0.25 \cdot \text{Recency} + 0.25 \cdot \text{Salience} + 0.20 \cdot \text{Importance} + 0.30 \cdot \text{Context}$$
     where $\text{Recency} = \frac{1}{1 + \frac{\Delta t}{604800}}$.
   - Deterministic tie-breaking: $S_{\text{total}}$ DESC, $M.\text{fictional\_time}$ DESC, $M.\text{lws\_id}$ ASC.
   - Mutable patching for allowed fields only (`summary`, `details`, `emotional_salience`, `importance`, `confidence`, `status`, `tags`, `deleted_at`), preserving immutable causal fields.

5. Implemented Character Beliefs & Suspicions (`src/living-world/perception/beliefs.js`):
   - Persistent schema: `subject_key`, `belief_type`, `statement`, `confidence` ($1 \le \text{confidence} \le 100$), `source_basis`, `causal_event_id`, `deleted_at`.
   - Authoritative mutation via `DIRECTOR_MODIFY_STATE` and event payloads.

6. Implemented Simulation Cameras & Perspectives (`src/living-world/perception/camera.js`):
   - Camera tracking with modes: `follow_character`, `observe_location`, `god_view`.
   - Privileged Observer Perspective (`GET /api/living-world/simulations/:simLwsId/observer/perspective`): Omniscient ground truth directly from simulation state.
   - Subjective Character Perspective (`GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/perspective`): Filtered by perceptions, active knowledge, recent memories, and current beliefs.

7. Deterministic Derived Identities & Pure Zero-SQL Replay (`src/living-world/events/replay.js`):
   - Deterministic UUIDs generated via SHA-256 namespace hashing `generateDeterministicUuid(namespace, ...parts)`.
   - `simulationReducer` reconstructs perceptions, knowledge, memories, beliefs, and camera state in pure memory with zero SQL queries.
   - `verifySimulationParity` proves 100% attribute parity with database state.

8. Mounted Exactly 13 REST Endpoints (`src/endpoints/living-world.js`):
   - Full REST transport with input validation, error handling, and authorization matching the frozen Phase 6 API table.

### Reason
Fulfill Phase 6 of the Living World Simulator plan: implement non-omniscient character perception, subjective knowledge, memory formation with decay retrieval, beliefs/suspicions, simulation camera perspectives, privileged Observer perspective, and pure zero-SQL replay.

### Files/modules
- `src/living-world/authored/common.js`
- `src/living-world/simulations/common.js`
- `src/living-world/migrations/006_perception_and_knowledge.js`
- `src/living-world/migrations/index.js`
- `src/living-world/perception/spatial.js`
- `src/living-world/perception/perceptions.js`
- `src/living-world/perception/knowledge.js`
- `src/living-world/perception/memories.js`
- `src/living-world/perception/memory-retrieval.js`
- `src/living-world/perception/beliefs.js`
- `src/living-world/perception/camera.js`
- `src/living-world/events/taxonomy.js`
- `src/living-world/events/events.js`
- `src/living-world/events/state-transitions.js`
- `src/living-world/events/replay.js`
- `src/endpoints/living-world.js`
- `src/living-world/index.js`
- `docs/living-world/decisions/ADR-014-perception-knowledge-memory-and-observation.md`
- `docs/living-world/PROJECT_STATE.md`
- `docs/living-world/PERSISTENCE.md`
- `tests/living-world/lws-perception-db.test.js`
- `tests/living-world/lws-perception-spatial.test.js`
- `tests/living-world/lws-knowledge.test.js`
- `tests/living-world/lws-memories.test.js`
- `tests/living-world/lws-beliefs.test.js`
- `tests/living-world/lws-camera-observer.test.js`
- `tests/living-world/lws-perception-replay.test.js`
- `tests/living-world/lws-perception-api.test.js`

### Architecture
- Closed 29-event taxonomy preserved with zero additions.
- Database version advances to `PRAGMA user_version = 6` with 5 new tables, 15 triggers, and 10 indexes.
- Option A canonical modality precedence enforced at runtime and storage.
- Non-omniscient character perspective vs privileged omniscient Observer perspective.
- 100% attribute parity verified between database execution and in-memory replay.

### Tests
- Targeted Phase 6 test suites: 8 suites / 42 tests passing.
- Cumulative LWS test suites: 39 suites / 284 tests passing.
- Full repository test suites: 58 suites / 695 tests passing.
- Root ESLint: 0 errors.
- Tests ESLint: 0 errors.

### Notes
- Autonomous character cognition, deliberation, and goal pursuit (Tier 3 arbitration) remain designed for Phase 7.

---

## 2026-09-24 — Phase 5: Fictional Time, Schedules, Routines, and Travel

Status: IMPLEMENTED / VERIFIED

### Change
Implemented authoritative fictional time progression, character routine arbitration, spatial travel mechanics, scheduled world events with reciprocal supersession, pure zero-SQL replay, and REST endpoints for Living World Simulator (LWS):

1. Created database migration `005_time_and_schedules.js` elevating schema version to `PRAGMA user_version = 5`:
   - Exactly 2 new tables: `lws_simulation_character_routines` and `lws_scheduled_events`.
   - Exactly 9 Phase 5 triggers (1 evolved monotonic clock trigger + 4 routine triggers + 4 scheduled-event triggers; 24 cumulative across system):
     1. `trg_lws_events_monotonic_and_sequence`: Replaces `trg_lws_events_fictional_time_matches_sim`, enforcing sequence monotonicity, clock non-retroactivity, and unbroken incremental sequencing.
     2. `trg_lws_routines_sim_immutable`: Enforces immutability of `simulation_id` and `simulation_character_id` on routine updates.
     3. `trg_lws_routines_char_same_sim`: Validates character simulation membership and active world location existence on insertion.
     4. `trg_lws_routines_same_world_loc`: Validates updated target location belongs to simulation world and is not soft-deleted.
     5. `trg_lws_routines_no_delete`: Enforces soft-delete only for routines.
     6. `trg_lws_sched_events_terminal_immutable`: Freezes terminal events (`triggered`, `cancelled`, `superseded`).
     7. `trg_lws_sched_events_sim_immutable`: Validates location, self-supersession, predecessor status (`pending`), reciprocal successor linkage, and trigger/cancel linkages on insertion.
     8. `trg_lws_sched_events_integrity`: Enforces simulation immutability, location validity, immutable established supersession, reciprocal supersession consistency, and trigger/cancel linkages on update.
     9. `trg_lws_sched_events_no_delete`: Prohibits direct `DELETE` on scheduled events.
   - Exactly 4 new indexes: `idx_lws_routines_sim_char`, `idx_lws_routines_lookup`, `idx_lws_sched_events_sim_time` (`WHERE status = 'pending'`), `idx_lws_sched_events_sim_status`.
   - Cumulative database inventory: Exactly 16 tables (reconciles the Section 14.2 text erratum stating 15), 24 triggers on Phase 4/5 tables, 11 indexes.

2. Activated all 6 Phase 5 event types in the closed 29-event taxonomy:
   - All 29 event types active, 0 deferred, 19 stateful.
   - One Authoritative Path policy: `POST /events` rejects all 6 Phase 5 event types with HTTP 422 `DEDICATED_ROUTE_REQUIRED`.

3. Implemented Temporal Modules (`src/living-world/time/`):
   - `routines.js`: 6-tier deterministic arbitration, 24-hour validation, overnight matching, and day specificity ranking.
   - `scheduled-events.js`: Querying, validation, and DTO formatting for scheduled world events.
   - `travel.js`: Tree distance LCA computation, connection override lookup, planned departure, and arrival ETA.
   - `time-advance.js`: Timeline resolution engine discovering critical sub-events in $(T_{\text{start}}, T_{\text{target}}]$, travel departure/arrival execution, severe condition suspension/recovery, zero-duration advance idempotence, and deterministic sub-event sequence ordering.

4. Expanded Pure Replay and Parity Engine (`src/living-world/events/replay.js`):
   - `simulationReducer` handles all 6 Phase 5 events in-memory with zero SQL queries.
   - `verifySimulationParity` proves 100% attribute parity across simulations, characters, routines, and scheduled events with zero drift.

5. Mounted 8 Dedicated REST Endpoints (`src/endpoints/living-world.js`):
   - `POST /api/living-world/simulations/:simLwsId/time-advance`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/routines`
   - `PUT /api/living-world/simulations/:simLwsId/characters/:charLwsId/routines`
   - `POST /api/living-world/simulations/:simLwsId/scheduled-events`
   - `GET /api/living-world/simulations/:simLwsId/scheduled-events`
   - `GET /api/living-world/simulations/:simLwsId/scheduled-events/:eventLwsId`
   - `POST /api/living-world/simulations/:simLwsId/scheduled-events/:eventLwsId/cancel`
   - `POST /api/living-world/simulations/:simLwsId/scheduled-events/:eventLwsId/supersede`

### Reason
Fulfill Phase 5 of the Living World Simulator plan: implement autonomous character routines, scheduled world events, spatial travel consuming fictional time, discrete timeline advancement, and pure zero-SQL replay.

### Files/modules
- `src/living-world/migrations/005_time_and_schedules.js`
- `src/living-world/simulations/lock.js`
- `src/living-world/time/routines.js`
- `src/living-world/time/scheduled-events.js`
- `src/living-world/time/travel.js`
- `src/living-world/time/time-advance.js`
- `src/living-world/events/taxonomy.js`
- `src/living-world/events/authority.js`
- `src/living-world/events/events.js`
- `src/living-world/events/state-transitions.js`
- `src/living-world/events/replay.js`
- `src/endpoints/living-world.js`
- `tests/living-world/lws-time-db.test.js`
- `tests/living-world/lws-routines.test.js`
- `tests/living-world/lws-scheduled-events.test.js`
- `tests/living-world/lws-travel.test.js`
- `tests/living-world/lws-time-advance.test.js`
- `tests/living-world/lws-time-replay.test.js`
- `tests/living-world/lws-time-security.test.js`
- `docs/living-world/decisions/ADR-013-temporal-progression-schedules-routines-travel.md`
- `docs/living-world/PERSISTENCE.md`
- `docs/living-world/PROJECT_STATE.md`
- `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Enforces Three Timestamp Classes: Direct events ($T_{\text{current}}$), Consequence events ($[T_{\text{start}}, T_{\text{target}}]$), Root Advance ($T_{\text{target}}$).
- One Authoritative Path: dedicated routes required for all temporal mutations.
- Pure Zero-SQL Replay: deterministic in-memory fold matches SQLite projections 100%.
- Database Boundary Invariants: monotonic clocks, reciprocal supersession consistency, and soft-delete protection enforced via triggers.

### Tests
- Targeted LWS test suite: 31 passed suites, 241 passed tests.
- Full repository unit test suite: 50 passed suites, 652 passed tests.
- Root linter (`npm run lint`): 0 errors, 0 warnings.
- Tests linter (`npm --prefix tests run lint`): 0 errors, 2 warnings (existing upstream Playwright warnings).

### Notes
- Zero browser automation / DevTools tests used (strictly conforms to AGENTS.md rule 16).
- Cumulative database schema: 15 tables, 24 triggers, 11 indexes.

---

## 2026-09-23 — Phase 4: Events, Authority, and State Transitions

Status: IMPLEMENTED / VERIFIED

### Change
Implemented the authoritative event ledger, 4-stage authority pipeline, narrative turn savepoint execution model, pure in-memory zero-SQL replay engine, and REST endpoints for Living World Simulator (LWS):

1. Created database migration `004_events_and_authority.js` elevating schema version to `PRAGMA user_version = 4`:
   - Exactly 2 runtime tables: `lws_narrative_turns` and `lws_events`.
   - Exactly 16 SQLite database triggers:
     1. `trg_lws_events_immutable_all`: Rejects direct `UPDATE` on `lws_events`.
     2. `trg_lws_events_no_delete`: Rejects direct `DELETE` on `lws_events`.
     3. `trg_lws_events_same_sim_actor`: Enforces that `actor_character_id` belongs to the same simulation as the event.
     4. `trg_lws_events_same_sim_target`: Enforces that `target_character_id` belongs to the same simulation as the event.
     5. `trg_lws_events_same_world_authored`: Enforces that `authored_character_id` belongs to the same world as the simulation.
     6. `trg_lws_events_same_world_location`: Enforces that `location_id` belongs to the same world as the simulation.
     7. `trg_lws_events_fictional_time_matches_sim`: Enforces that event `fictional_time` matches parent simulation `current_fictional_time`.
     8. `trg_lws_events_causal_integrity`: Enforces that `causal_event_id` belongs to the same simulation and has a strictly preceding sequence (`sequence_number < NEW.sequence_number`).
     9. `trg_lws_events_same_sim_turn`: Enforces that `turn_id` belongs to the same simulation as the event.
     10. `trg_lws_events_char_actor_required`: Requires `actor_character_id` on character-specific state events.
     11. `trg_lws_events_start_actor_prohibited`: Prohibits `actor_character_id` or `target_character_id` on `SIMULATION_START`.
     12. `trg_lws_events_join_authored_required`: Requires `authored_character_id` on `CHARACTER_JOIN`.
     13. `trg_lws_narrative_turns_sim_immutable`: Prohibits mutating `simulation_id` on narrative turns.
     14. `trg_lws_narrative_turns_turn_num_immutable`: Prohibits mutating `turn_number` on narrative turns.
     15. `trg_lws_narrative_turns_terminal_immutable`: Enforces terminal turn states (`committed`, `rejected`, `failed` turns cannot be mutated).
     16. `trg_lws_narrative_turns_no_delete`: Rejects direct `DELETE` on narrative turns.
   - Exactly 7 database indexes:
     1. `idx_lws_events_sim_seq` (unique on `lws_events(simulation_id, sequence_number)`)
     2. `idx_lws_events_sim_time` (on `lws_events(simulation_id, fictional_time, sequence_number)`)
     3. `idx_lws_events_actor` (on `lws_events(actor_character_id) WHERE actor_character_id IS NOT NULL`)
     4. `idx_lws_events_authored_char` (on `lws_events(authored_character_id) WHERE authored_character_id IS NOT NULL`)
     5. `idx_lws_events_idempotency` (unique on `lws_events(simulation_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
     6. `idx_lws_events_turn` (on `lws_events(turn_id) WHERE turn_id IS NOT NULL`)
     7. `idx_lws_narrative_turns_sim_turn` (unique on `lws_narrative_turns(simulation_id, turn_number)`)
2. Created events and authority domain modules under `src/living-world/events/`:
   - `taxonomy.js`: Closed 29-event taxonomy (23 active Phase 4 events, 6 deferred Phase 5 events, 13 stateful events), deepMerge, and JSON schema payload validators.
   - `authority.js`: 4-stage authority pipeline (Schema, Structural/Provenance, Domain, Authority Decision), enforcing that `system` and `simulation_engine` cannot be forged by external callers and `director` requires admin privileges.
   - `state-transitions.js`: Transition handlers for all 13 stateful events, updating projections in SQLite.
   - `events.js`: Monotonic sequence generation, SHA-256 idempotency fingerprinting, `commitEvent`, `getEventByLwsId`, and `listEvents`.
   - `narrative-turns.js`: Two-transaction savepoint execution (`executeNarrativeTurn`), rollback to savepoint on failure, durable rejected turn persistence with `error_details` (HTTP 422), `getNarrativeTurnByLwsId`, and `listNarrativeTurns`.
   - `replay.js`: Pure in-memory zero-SQL `simulationReducer`, `replaySimulation`, and canonical parity verification (`verifySimulationParity`).
3. Refactored Phase 3 services in `src/living-world/simulations/`:
   - `simulations.js`: `createSimulation`, `updateSimulation`, and `deleteSimulation` refactored to delegate state mutations strictly to `commitEvent` (`SIMULATION_START`, `DIRECTOR_MODIFY_STATE`, `SIMULATION_PAUSE`, `SIMULATION_RESUME`, `SIMULATION_STOP`).
   - `simulation-characters.js`: `addSimulationCharacter`, `updateSimulationCharacter`, and `deleteSimulationCharacter` refactored to delegate strictly to `commitEvent` (`CHARACTER_JOIN`, `MOVE_CHARACTER`, `UPDATE_CHARACTER_ACTIVITY`, `UPDATE_PHYSICAL_CONDITION`, `UPDATE_RUNTIME_STATE`, `DIRECTOR_MODIFY_STATE`, `CHARACTER_LEAVE`).
4. Mounted 7 REST endpoints in `src/endpoints/living-world.js`:
   - `POST /api/living-world/simulations/:simLwsId/turns`
   - `GET /api/living-world/simulations/:simLwsId/turns`
   - `GET /api/living-world/simulations/:simLwsId/turns/:turnLwsId`
   - `POST /api/living-world/simulations/:simLwsId/events`
   - `GET /api/living-world/simulations/:simLwsId/events`
   - `GET /api/living-world/simulations/:simLwsId/events/:eventLwsId`
   - `POST /api/living-world/simulations/:simLwsId/replay-verify`
5. Authored ADR-012 in `docs/living-world/decisions/ADR-012-authoritative-event-ledger-and-state-transitions.md`.

### Reason
Fulfills Phase 4 of the LWS implementation roadmap, establishing the core architectural invariant:
"LLM/User Proposes -> Simulation Engine Decides -> Database Records Reality -> Narrative Presents Reality".

### Files/modules
- `src/living-world/migrations/004_events_and_authority.js`
- `src/living-world/migrations/index.js`
- `src/living-world/errors.js`
- `src/living-world/events/taxonomy.js`
- `src/living-world/events/authority.js`
- `src/living-world/events/state-transitions.js`
- `src/living-world/events/events.js`
- `src/living-world/events/narrative-turns.js`
- `src/living-world/events/replay.js`
- `src/living-world/simulations/simulations.js`
- `src/living-world/simulations/simulation-characters.js`
- `src/living-world/index.js`
- `src/endpoints/living-world.js`
- `tests/living-world/lws-events-db.test.js`
- `tests/living-world/lws-events-authority.test.js`
- `tests/living-world/lws-events-transitions.test.js`
- `tests/living-world/lws-narrative-turns.test.js`
- `tests/living-world/lws-events-replay.test.js`
- `tests/living-world/lws-events-api.test.js`
- `docs/living-world/decisions/ADR-012-authoritative-event-ledger-and-state-transitions.md`
- `docs/living-world/PERSISTENCE.md`
- `docs/living-world/PROJECT_STATE.md`
- `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Enforces append-only immutable event ledger at SQLite engine level.
- Enforces strict 4-stage authority validation. Server blocks unauthenticated provenance claims.
- Decouples narrative turn audit persistence from proposal execution via two-transaction savepoint model.
- Eliminates direct runtime row mutation bypasses in Phase 3 services.
- Proves pure in-memory zero-SQL replay with 100% attribute parity against projected rows.

### Tests
- Full living-world test suite passes: 24 test suites, 183 tests.
- Linters clean on root and tests (`npm run lint`, `npm --prefix tests run lint`).

### Notes
- Phase 5 systems (time advance, scheduled events, routines, travel calculations) remain strictly deferred to Phase 5.

---

## 2026-09-23 — Phase 3: Simulation Runtime and Persistence

Status: IMPLEMENTED / VERIFIED / ACCEPTED

### Change
Implemented the simulation runtime and persistence layer for the Living World Simulator (LWS):

1. Created database migration `003_simulation_runtime.js` elevating schema version to `PRAGMA user_version = 3`:
   - Exactly 2 runtime tables: `lws_simulations` and `lws_simulation_characters`.
   - Exactly 10 SQLite database triggers:
     1. `trg_lws_simulations_world_id_immutable` (BEFORE UPDATE OF world_id ON lws_simulations)
     2. `trg_lws_simulations_scenario_id_immutable` (BEFORE UPDATE OF scenario_id ON lws_simulations)
     3. `trg_lws_simulations_scenario_same_world_insert` (BEFORE INSERT ON lws_simulations)
     4. `trg_lws_simulations_status_transition` (BEFORE UPDATE OF status ON lws_simulations)
     5. `trg_lws_sim_chars_simulation_id_immutable` (BEFORE UPDATE OF simulation_id ON lws_simulation_characters)
     6. `trg_lws_sim_chars_character_id_immutable` (BEFORE UPDATE OF character_id ON lws_simulation_characters)
     7. `trg_lws_sim_chars_authored_snapshot_immutable` (BEFORE UPDATE OF authored_snapshot ON lws_simulation_characters)
     8. `trg_lws_sim_chars_same_world_insert` (BEFORE INSERT ON lws_simulation_characters)
     9. `trg_lws_sim_chars_location_insert` (BEFORE INSERT ON lws_simulation_characters: verifies same-world and blocks soft-deleted location)
     10. `trg_lws_sim_chars_location_update` (BEFORE UPDATE OF current_location_id ON lws_simulation_characters: verifies same-world and blocks newly assigning soft-deleted location while preserving existing references)
   - Exactly 5 database indexes:
     - `idx_lws_simulations_world` on `lws_simulations(world_id) WHERE deleted_at IS NULL`
     - `idx_lws_simulations_name_active` (partial unique index on `lws_simulations(world_id, name COLLATE NOCASE) WHERE deleted_at IS NULL`)
     - `idx_lws_sim_chars_sim` on `lws_simulation_characters(simulation_id) WHERE deleted_at IS NULL`
     - `idx_lws_sim_chars_unique_active` (partial unique index on `lws_simulation_characters(simulation_id, character_id) WHERE deleted_at IS NULL`)
     - `idx_lws_sim_chars_location` on `lws_simulation_characters(current_location_id) WHERE deleted_at IS NULL`
2. Created simulation domain modules under `src/living-world/simulations/`:
   - `common.js`: Semantic calendar date validation (`validateFictionalTimestamp`) validating Gregorian leap years, days in month, and 24h clock bounds; status transition matrix validation; and active world/simulation lookups with soft-delete gating.
   - `simulations.js`: Full simulation lifecycle CRUD, scenario instantiation with atomic roster creation and frozen snapshots, active name uniqueness, status transition enforcement, and soft-deletion (allowed from `active`, `paused`, and `archived`). Simulation soft-deletion sets `deleted_at = isoNow()`; child `lws_simulation_characters` rows remain physically intact in SQLite for audit and replay, while child routes return 404 via parent simulation status gating. `updateSimulation` permits updating `name`, `status`, `settings`, and `extensions`, while rejecting attempts to modify `world_id`, `scenario_id`, or `current_fictional_time` with HTTP 400.
   - `simulation-characters.js`: SimulationCharacter CRUD, runtime state mutations (`current_location_id`, `activity`, `physical_condition`, `runtime_state`), duplicate active character conflict rejection (409), paused/archived mutation protection, soft-deleted location assignment guards, and soft-deletion.
3. Established Hybrid Runtime Identity & Snapshots (ADR-011):
   - Runtime instances maintain independent identities and lineages to authored characters without mutating authored tables.
   - Authored cards are snapshotted immutably into `authored_snapshot` upon instantiation.
4. Expanded REST API transport in `src/endpoints/living-world.js`:
   - Added 10 authenticated endpoints for simulation and simulation character operations:
     - `POST /worlds/:worldLwsId/simulations`
     - `GET /worlds/:worldLwsId/simulations`
     - `GET /simulations/:simLwsId`
     - `PATCH /simulations/:simLwsId`
     - `DELETE /simulations/:simLwsId`
     - `POST /simulations/:simLwsId/characters`
     - `GET /simulations/:simLwsId/characters`
     - `GET /simulations/:simLwsId/characters/:simCharLwsId`
     - `PATCH /simulations/:simLwsId/characters/:simCharLwsId`
     - `DELETE /simulations/:simLwsId/characters/:simCharLwsId`
   - Scoped with deleted-World and deleted-Simulation gating.
5. Automated testing and two-simulation isolation proof:
   - Added 5 new test suites: `lws-simulations-db.test.js`, `lws-simulations.test.js`, `lws-simulation-characters.test.js`, `lws-simulations-isolation.test.js`, and `lws-simulations-api.test.js`.
   - Updated existing test suites to assert `user_version = 3`.
   - Verified that two concurrent simulations in the same world progress independently with different locations, activities, and conditions without state collision, and verified that soft-deleting authored cards does not corrupt running simulations.

### Reason
Fulfill Phase 3 of the LWS roadmap to establish persistent runtime simulations and simulation character instances, strictly separating authored definitions from runtime mutations while providing robust database-level integrity, semantic date validation, and status lifecycle control.

### Files/modules
- Created:
  - `src/living-world/migrations/003_simulation_runtime.js`
  - `src/living-world/simulations/common.js`
  - `src/living-world/simulations/simulations.js`
  - `src/living-world/simulations/simulation-characters.js`
  - `tests/living-world/lws-simulations-db.test.js`
  - `tests/living-world/lws-simulations.test.js`
  - `tests/living-world/lws-simulation-characters.test.js`
  - `tests/living-world/lws-simulations-isolation.test.js`
  - `tests/living-world/lws-simulations-api.test.js`
  - `docs/living-world/decisions/ADR-011-hybrid-simulation-runtime-identity-and-snapshots.md`
- Modified:
  - `src/living-world/migrations/index.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `tests/living-world/fixtures/test-db.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-st-integration.test.js`
  - `tests/living-world/lws-authored-domain.test.js`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/PERSISTENCE.md`
  - `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Strict enforcement of separation between authored definitions (`lws_characters`, `lws_worlds`, `lws_locations`) and runtime simulation state (`lws_simulations`, `lws_simulation_characters`).
- Immutability enforced at database trigger boundary for foreign key lineages, originating scenarios, and frozen authored snapshots.
- Single-point entry and parent soft-delete gating on REST endpoints.

### Tests
- Unit and integration tests passing: 18/18 LWS suites (132/132 tests).
- SillyTavern full test suite passing: 37/37 suites (543/543 tests).
- ESLint checks passing cleanly with 0 errors across root and test directories.

### Notes
- Event ledgers (`lws_events`) and causal tick management (`lws_ticks`) are explicitly reserved for Phase 4. Fictional time progression engine, scheduled routines, and travel engines are reserved for Phase 5.

---

## 2026-09-23 — Phase 2: Authored World and Character Model

Status: IMPLEMENTED / VERIFIED / ACCEPTED

### Change
Implemented the authored world and character model for the Living World Simulator (LWS):

#### Approved Plan Scope
1. Created database migration `002_authored_model.js` elevating schema version to `PRAGMA user_version = 2`:
   - Exactly 9 tables: 7 entity tables (`lws_worlds`, `lws_characters`, `lws_locations`, `lws_factions`, `lws_scenarios`, `lws_world_rules`, `lws_authored_prompt_configs`) + 2 join tables (`lws_character_factions`, `lws_scenario_characters`).
   - Exactly 12 SQLite triggers:
     - 6 `BEFORE UPDATE OF world_id` triggers blocking `world_id` mutations across all child entity tables.
     - 4 cross-world relationship triggers on join tables (`BEFORE INSERT` and `BEFORE UPDATE` on `lws_character_factions` and `lws_scenario_characters`).
     - 2 cross-world starting location triggers on `lws_scenarios` (`BEFORE INSERT` and `BEFORE UPDATE OF starting_location_id`).
2. Created domain service modules under `src/living-world/authored/`:
   - `common.js`: UUID validation, timestamps, payload sanitization, active world parent lookup.
   - `worlds.js`: World lifecycle (create, get, list, update, soft-delete).
   - `characters.js`: Character CRUD with supported mapped ST Character V2 subset (`name`, `description`, `personality`, `scenario_context` mapped from ST `scenario`, `mes_example`, `author_notes`, `system_prompt_override`, `source_version`, `tags`, `extensions`).
   - `locations.js`: Location CRUD.
   - `factions.js`: Faction CRUD and member association management (`addMember`, `removeMember`, `listMembers`), filtering soft-deleted members on read and blocking association with soft-deleted characters.
   - `scenarios.js`: Scenario CRUD, starting location verification, and scenario roster management (`addRosterCharacter`, `removeRosterCharacter`, `listRoster`), filtering soft-deleted characters and blocking association with soft-deleted entities.
   - `world-rules.js`: WorldRule CRUD with integer `sort_order`.
   - `prompt-configs.js`: AuthoredPromptConfig 1:1 per-world management, raising HTTP 409 conflict on duplicate creation attempt.
3. Expanded REST API transport in `src/endpoints/living-world.js`:
   - 40+ REST routes covering all authored entities and relationships under `/api/living-world/worlds/:worldLwsId/*`.
   - Parent world gating: any request under `/api/living-world/worlds/:worldLwsId/*` when the parent world is soft-deleted returns `404 {"error": "World not found"}` while child database rows remain intact.
   - Input validation: invalid UUIDs return 400; missing required fields return 400; unique name collisions return 409; cross-world / soft-deleted entity references return 400 or 404.
4. Comprehensive automated test coverage:
   - Added 8 dedicated unit test suites and 1 end-to-end domain/isolation suite under `tests/living-world/`.
   - Updated existing Phase 1 suites (`lws-db.test.js`, `lws-init.test.js`, `lws-st-integration.test.js`, `lws-api.test.js`) to assert schema version 2 and verified backward/forward migration stability.

#### Implementation Enhancements (Beyond Original Plan)
The implemented Phase 2 includes two capabilities that were not explicitly present in the originally reviewed Phase 2 plan:
- **Enhancement A — Hierarchical Locations**:
  The implemented Location service supports self-referential parent locations (`lws_locations.parent_location_id`), hierarchical authored locations (e.g. World → Region → City → Building → Room), parent-location validation (confirming parent belongs to the same world and is active), and circular-reference detection in domain validation (preventing a location from becoming an ancestor of itself).
- **Enhancement B — Active Name Uniqueness**:
  Migration 002 implements 5 partial unique indexes (`WHERE deleted_at IS NULL` with `COLLATE NOCASE`) in SQLite:
  - `idx_lws_worlds_name_active` on `lws_worlds(name)`
  - `idx_lws_characters_name_active` on `lws_characters(world_id, name)`
  - `idx_lws_locations_name_active` on `lws_locations(world_id, name)`
  - `idx_lws_factions_name_active` on `lws_factions(world_id, name)`
  - `idx_lws_scenarios_name_active` on `lws_scenarios(world_id, name)`
  These enforce case-insensitive uniqueness of active entity names within their world scope (and global scope for active worlds). Because the indexes filter on `deleted_at IS NULL`, soft-deleted entity names can be legitimately reused without conflict.

### Reason
Fulfill Phase 2 roadmap to establish canonical authored world, character, location, faction, scenario, rule, and prompt configuration models in SQLite, strictly separating authored definitions from future runtime simulation state while maintaining compatibility with SillyTavern's Character Card V2 schema.

### Files/modules
- Created:
  - `src/living-world/migrations/002_authored_model.js`
  - `src/living-world/authored/common.js`
  - `src/living-world/authored/worlds.js`
  - `src/living-world/authored/characters.js`
  - `src/living-world/authored/locations.js`
  - `src/living-world/authored/factions.js`
  - `src/living-world/authored/scenarios.js`
  - `src/living-world/authored/world-rules.js`
  - `src/living-world/authored/prompt-configs.js`
  - `tests/living-world/lws-authored-worlds.test.js`
  - `tests/living-world/lws-authored-characters.test.js`
  - `tests/living-world/lws-authored-locations.test.js`
  - `tests/living-world/lws-authored-factions.test.js`
  - `tests/living-world/lws-authored-scenarios.test.js`
  - `tests/living-world/lws-authored-world-rules.test.js`
  - `tests/living-world/lws-authored-prompt-configs.test.js`
  - `tests/living-world/lws-authored-domain.test.js`
  - `tests/living-world/lws-authored-api.test.js`
- Modified:
  - `src/living-world/errors.js`
  - `src/living-world/migrations/index.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-st-integration.test.js`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/AI_CHANGELOG.md`
  - `docs/living-world/PERSISTENCE.md`

### Architecture
- Authored state only: zero runtime simulation state is introduced in Phase 2.
- Data integrity enforced at both database and domain service layers via SQLite triggers and transactions.
- Soft-delete semantics preserve historical authored entity records while hiding them from active API queries.
- Clean isolation between SillyTavern character card storage and LWS SQLite persistent storage.

### Tests
- 32 test suites passed, 499 tests passed across the full test suite (0 failures, 0 regressions).
- LWS-specific unit and integration tests: 88 passing tests across 13 LWS test files.
- Linter verification: root linter 0 errors, tests linter 0 errors.

### Notes
- Distinguishes original approved Phase 2 scope from the two implementation enhancements (hierarchical locations and active name uniqueness).
- Authored models are now ready for Phase 3 (Simulation Runtime and Persistence), which will create runtime simulations referencing these authored definitions. Future Phase 3 scope (`Simulation`, `SimulationCharacter`, runtime locations/activity, needs/inventory) remains completely unstarted.

---

## 2026-09-23 — Phase 1: LWS Host Foundation

Status: VERIFIED

### Change
Established the native Living World Simulator (LWS) subsystem host foundation within the SillyTavern fork:
1. Pinned exact production dependency `better-sqlite3: 12.9.0` (with Node 20–24 verified prebuilds) in `package.json` and `package-lock.json`.
2. Created subsystem backend module `src/living-world/`:
   - `errors.js`: Custom LWS error classes (`LwsError`, `LwsNotInitializedError`, `LwsValidationError`).
   - `migrations/001_initial.js`: Phase 1 metadata schema migration.
   - `migrations/index.js`: Deterministic migration runner using `PRAGMA user_version`.
   - `db.js`: Database lifecycle manager configuring WAL mode and foreign keys, safely closing partially opened handles on initialization errors and isolating persistence under `data/living-world/lws.db`.
   - `index.js`: Subsystem entry point implementing safe degraded failure semantics (non-fatal to SillyTavern).
3. Created endpoint router `src/endpoints/living-world.js` exposing `GET /api/living-world/status` (200 healthy / 503 degraded) and `POST /api/living-world/ping` (200 healthy / 503 degraded).
4. Integrated into host server lifecycle:
   - Registered `/api/living-world` in `src/server-startup.js` inside `setupPrivateEndpoints()`, placed behind ST's `requireLoginMiddleware`.
   - Initialized LWS in `src/server-main.js` during `preSetupTasks()` and hooked cleanup into `exitProcess()`.
5. Created frontend bootstrap module `public/scripts/living-world/index.js` and loaded via `<script type="module">` in `public/index.html`.
6. Created comprehensive automated tests in `tests/living-world/` (fixtures, db, init, api unit, and ST HTTP integration).

### Reason
Fulfill the Phase 1 objective to establish the native LWS subsystem host foundation without creating a second server, second application, or separate UI framework.

### Files/modules
- Created:
  - `src/living-world/errors.js`
  - `src/living-world/migrations/001_initial.js`
  - `src/living-world/migrations/index.js`
  - `src/living-world/db.js`
  - `src/living-world/index.js`
  - `src/endpoints/living-world.js`
  - `public/scripts/living-world/index.js`
  - `data/living-world/.gitkeep`
  - `tests/living-world/fixtures/test-db.js`
  - `tests/living-world/lws-db.test.js`
  - `tests/living-world/lws-init.test.js`
  - `tests/living-world/lws-api.test.js`
  - `tests/living-world/lws-st-integration.test.js`
- Modified:
  - `.gitignore`
  - `package.json`
  - `package-lock.json`
  - `src/server-startup.js`
  - `src/server-main.js`
  - `public/index.html`
  - `docs/living-world/PROJECT_STATE.md`
  - `docs/living-world/AI_CHANGELOG.md`

### Architecture
- Established native LWS namespace inside existing SillyTavern fork.
- Transport layer (`src/endpoints/living-world.js`) is thin and contains zero simulation logic.
- Persistence is strictly isolated in SQLite (`data/living-world/lws.db`), separated from SillyTavern chat JSON storage.
- Authentication is inherited from SillyTavern's existing `requireLoginMiddleware` rather than creating a secondary auth system.
- Subsystem failure policy is fail-closed for LWS, non-fatal for SillyTavern.

### Tests
- `tests/living-world/lws-db.test.js`: 7 passed (user_version tracking, migration idempotence, foreign keys pragma, WAL mode verification on file-backed DB, persistence restart durability, ST storage isolation).
- `tests/living-world/lws-init.test.js`: 4 passed (clean startup, directory creation, idempotence, shutdown handle release, controlled initialization failure handling).
- `tests/living-world/lws-api.test.js`: 5 passed (GET status 200, POST ping 200, 404 for unknown subpaths, 503 when degraded, leak prevention for DB paths/stack traces).
- `tests/living-world/lws-st-integration.test.js`: 5 passed (HTTP 403 unauthenticated rejection via ST auth, HTTP 200 authenticated status via setupPrivateEndpoints, HTTP 200 ping, HTTP 404 unknown subpath).
- Entire Jest unit test suite: 23 suites passed, 432 tests passed (including all 411 existing ST tests with 0 regressions).
- Real ST server process execution test (`server.js` spawn): verified real process startup logging `[LWS] Subsystem initialized (schema version 1)`, live HTTP query to `/api/living-world/status` returning HTTP 200 with `{ initialized: true, schemaVersion: 1 }`, and verified `data/living-world/lws.db` on disk.
- Linter verification: `npm run lint` and `npm --prefix tests run lint` completed with 0 errors.
- Prohibited tooling check: No browser automation, Playwright, or DevTools used.

### Notes
- Dependency `better-sqlite3: 12.9.0` was installed with exact pinning; version `12.9.1` does not exist in the npm registry (HTTP 404), so `12.9.0` (which includes precompiled binaries for Node 20 through 24 on win32-x64) was pinned.
- Phase 1 schema contains only the `lws_meta` table. Future domain tables (authored worlds, characters, runtime state) will be added via migrations in subsequent phases.
