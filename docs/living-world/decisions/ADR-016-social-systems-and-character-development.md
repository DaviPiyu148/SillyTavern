# ADR-016: Social Systems, Relationships, Rumors, Factions, and Character Development

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 8)

## Context

Living World Simulator (LWS) requires characters to exist within a dynamic, persistent social matrix where interactions have durable consequences, information spreads realistically, group affiliations exist without hive minds, and persistent character evolution occurs only with causal evidence.

Prior phases established:
- Authored models and simulation instances (Phases 1–3, ADR-011).
- The authoritative event ledger, transition engine, and closed 29-event taxonomy (Phase 4, ADR-012).
- Temporal progression, 6-tier routine arbitration, and travel (Phase 5, ADR-013).
- Spatial perception, subjective knowledge, episodic memory, and perspective isolation (Phase 6, ADR-014).
- Autonomous cognition, goals, needs, values, emotions, and decision deliberation (Phase 7, ADR-015).

Phase 8 implements the complete social and psychological evolution layer under strict simulation invariants:
1. **Core Invariant:** $\mathbf{LLM\ proposes.\ Simulation\ Engine\ decides.\ Database\ records\ reality.\ Narrative\ presents\ reality.}$
2. **Closed 29-Event Taxonomy:** Zero new event types introduced. All social state changes project through existing event types (`COMMUNICATE`, `TRANSFER_ITEM`, `COMBAT_ACTION`, `UPDATE_RUNTIME_STATE`, `DIRECTOR_MODIFY_STATE`, `TIME_ADVANCE`).
3. **Directional Asymmetry:** Social bonds are intrinsically asymmetric; Character A's attitude toward Character B does not dictate Character B's attitude toward Character A.
4. **Causal Evidence Ledger:** Every relationship shift and persistent character trait change must be anchored in verifiable causal events.
5. **Rumor Provenance & Topology:** Information transmission forms strict acyclic trees with bounded depth ($0..5$), provenance tracking, and distortion metrics.
6. **Non-Hive Faction Identity:** Faction membership provides standing, loyalty, and affiliation, but individual members maintain strictly independent values, needs, memories, and subjective beliefs.
7. **Zero-SQL Pure Replay Parity:** All social structures and character development records must be 100% reconstructible in pure memory with field-level database parity.

---

## Decision

### 1. Database Schema Migration (008_social_and_development)

Phase 8 establishes Migration 008 (`PRAGMA user_version = 8`), introducing 5 dedicated tables, 15 database triggers, and 10 indexes:

1. **`lws_character_relationships`**:
   - Directional pairwise edges (`source_character_id` $\to$ `target_character_id`).
   - 5 bounded integer dimensions: `trust` $[-100, 100]$, `affection` $[-100, 100]$, `familiarity` $[0, 100]$, `respect` $[-100, 100]$, `loyalty` $[-100, 100]$.
   - `last_interaction_fictional_time` timestamp.
   - Protected by uniqueness and mutation triggers.

2. **`lws_relationship_evidence`**:
   - Append-only causal interaction ledger.
   - Tracks `causal_event_id`, `fictional_time`, dimension deltas, `interaction_type`, and `narrative_rationale`.
   - Immutable via trigger `trg_lws_relationship_evidence_no_update`.

3. **`lws_social_information`**:
   - Rumor and social claim repository tracking tree topology: `parent_social_information_id`, `root_social_information_id`, `originator_character_id`, `transmitter_character_id`, `recipient_character_id`, `causal_event_id`.
   - Metadata: `subject_key`, `topic`, `claim_statement`, `veracity` (`true`, `distorted`, `false`, `unknown`), `ground_truth_event_id`, `distortion_level` $[0, 100]$, `transmission_depth` $[0, 5]$, `confidence_score` $[0, 100]$.
   - Append-only and immutable via trigger `trg_lws_social_information_no_update`.

4. **`lws_character_faction_memberships`**:
   - Runtime faction membership tracking `simulation_character_id`, `faction_id`, `rank_role`, `standing` $[-100, 100]$, `loyalty_score` $[0, 100]$, `membership_status` (`active`, `probation`, `suspended`, `exiled`, `defected`), `joined_fictional_time`.
   - Initialized deterministically on `CHARACTER_JOIN` from authored world definitions.

5. **`lws_character_development_records`**:
   - Causal ledger of permanent character psychological and behavioral development.
   - Tracks `dimension_category` (`value_shift`, `disposition_shift`, `habit_shift`, `baseline_need_shift`), `dimension_key`, `previous_value`, `new_value`, `delta`, `trigger_category` (`acute_trauma`, `sustained_experience`, `social_reinforcement`, `cognitive_dissonance`, `director_override`), `causal_event_ids`, `stability` $[0, 100]$, and `fictional_time`.
   - Append-only and immutable via trigger `trg_lws_character_development_records_no_update`.

---

### 2. Directional Relationships & Familiarity Decay

- **Asymmetric Representation:** Relationship state $R(A \to B) \neq R(B \to A)$. Updates to $A \to B$ do not alter $B \to A$ unless the causal event explicitly contains reciprocal deltas.
- **Clamping:** All dimension updates strictly clamped to their domain bounds.
- **Exponential Familiarity Decay:** In the absence of interaction beyond a 7-day grace period ($T_{\text{grace}} = 604,800\,\text{s}$), familiarity decays exponentially:
  $$F(t) = \text{round}\left(F_0 \cdot e^{-\frac{\Delta t - T_{\text{grace}}}{\tau}}\right), \quad \tau = 2,592,000\,\text{s}\ (30\,\text{days})$$
- Decay produces an authoritative `lws_relationship_evidence` entry tagged `interaction_type = 'decay'`.

---

### 3. Rumor Transmission Trees & Subjective Belief Adoption

- **17 Topology Invariants:** The rumor tree is strictly validated on creation across 13 negative and 4 positive topological rules:
  1. Depth must be in $0..5$.
  2. Root nodes (depth $0$) must have `parent = NULL` and `root_id = self`.
  3. Non-root nodes (depth $\ge 1$) must have non-null `parent` and depth equal to `parent.depth + 1`.
  4. Non-root nodes must inherit the root ID of their parent.
  5. Parent, root, transmitter, and recipient must belong to the same simulation.
  6. Cyclic parent references and self-parenting are prohibited.
  7. Transmission edges must match the event actor and target.
- **Subjective Belief Adoption:** When Character B receives social information from Character A via `COMMUNICATE`:
  - If $R(B \to A).\text{trust} \le -30$, the claim is rejected (untrusted).
  - If $R(B \to A).\text{trust} > -30$, a subjective belief is upserted in `lws_character_beliefs` with confidence scaled by trust:
    $$\text{confidence} = \text{clamp}\left(\text{round}\left(\text{confidence}_{\text{info}} \cdot \frac{\text{trust} + 100}{200}\right), 1, 100\right)$$

---

### 4. Non-Hive Factions & Identity Independence

- **Authored-to-Runtime Projection:** Authored character-faction associations (`lws_character_factions`) are automatically projected into `lws_character_faction_memberships` upon `CHARACTER_JOIN` with initial `standing = 0`, `loyalty_score = 50`, `membership_status = 'active'`.
- **Identity Independence:** Faction members maintain distinct personality values (`lws_character_values`), needs (`lws_character_needs`), emotions, and beliefs. Faction changes do not overwrite member internal cognition.

---

### 5. Causal Character Development & Dual-Store Projection

- **Causality Requirement:** Character development records require valid, non-empty `causal_event_ids` matching committed events in the simulation (or non-empty arrays under `director_override`).
- **Dual-Store Projection:**
  - `value_shift` projects onto `lws_character_values.strength`.
  - `baseline_need_shift` projects onto `lws_character_needs.decay_rate`.
  - `disposition_shift` and `habit_shift` project onto `lws_simulation_characters.runtime_state.dispositions` / `habits`.

---

### 6. Social Cognition Integration ($U_{\text{social}}$)

Phase 7 deliberation formula is extended with a fifth component $U_{\text{social}}$:
$$U_{\text{action}} = 0.35 \cdot U_{\text{need}} + 0.30 \cdot U_{\text{goal}} + U_{\text{social}} + 0.20 \cdot A_{\text{val}} + 0.15 \cdot B_{\text{emo}} - \text{Penalties}$$
Where $U_{\text{social}}$ evaluates directional relationship metrics with the target entity:
- **Pro-social actions (`COMMUNICATE`, `AID`, `TRANSFER_ITEM`, `ASSIST`):**
  $$U_{\text{social}} = 0.35 \cdot \text{affection} + 0.35 \cdot \text{trust} + 0.20 \cdot \text{loyalty} + 0.10 \cdot \text{respect} + \text{SameFactionBonus}$$
- **Hostile actions (`COMBAT_ACTION`, `BETRAY`, `STEAL`, `ATTACK`):**
  $$U_{\text{social}} = -0.40 \cdot \text{affection} - 0.40 \cdot \text{trust} - 0.20 \cdot \text{loyalty} - \text{SameFactionBonus}$$
- **Moral Veto Precedence:** Moral vetoes (e.g. honesty veto on deceptive action) execute prior to utility scoring and hard-veto actions regardless of high positive $U_{\text{social}}$.

---

### 7. Zero-SQL Pure In-Memory Replay Parity

`simulationReducer` in `src/living-world/events/replay.js` folds all Phase 8 state purely in-memory:
- `relationships` (pairwise map with clamping and familiarity decay)
- `relationshipEvidence` (interaction ledger)
- `socialInformation` (rumor trees)
- `factionMemberships` (runtime memberships)
- `developmentRecords` (development events and cognitive projections)
- `beliefs` (subjective beliefs from communication)

`verifySimulationParity` proves 100% field-level parity across all SQLite tables against replayed in-memory state.

---

### 8. Tri-Tier REST API Exposure

REST endpoints in `src/endpoints/living-world.js` are categorized into three explicit authority tiers:
1. **Tier 1 (Privileged Observer):**
   - `GET /api/living-world/simulations/:simLwsId/social/graph`
   - `GET /api/living-world/simulations/:simLwsId/social-information`
   - `GET /api/living-world/simulations/:simLwsId/social-information/:infoLwsId/tree`
   - `GET /api/living-world/simulations/:simLwsId/faction-memberships`
2. **Tier 2 (Subjective Character Perspective):**
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId/evidence`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/factions`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/development`
   - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/known-rumors`
3. **Tier 3 (Director Authority Interventions):**
   - `POST /api/living-world/simulations/:simLwsId/social-interventions`

---

## Consequences

- Characters maintain dynamic, believable social networks that influence cognition and action selection.
- Information propagation creates realistic narrative mysteries and misinformation without omniscient leaks.
- Character development is grounded in durable causality, preventing unearned personality shifts.
- Full replayability and database parity are preserved with 0 regressions across all 54 Living World test suites.
