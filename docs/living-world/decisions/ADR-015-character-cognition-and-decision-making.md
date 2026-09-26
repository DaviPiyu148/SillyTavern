# ADR-015: Character Cognition, Deliberation, and Decision Making

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 7)

## Context

In Living World Simulator (LWS), characters must behave as autonomous, believable agents with subjective internal motivations rather than purely reactive conversation partners. Prior phases established:
- Authored character cards and isolated simulation character instances (Phases 1–3, ADR-011).
- An authoritative, append-only event ledger and state transition engine (Phase 4, ADR-012).
- Temporal progression, 6-tier routine arbitration, and spatial travel (Phase 5, ADR-013).
- Spatial sensory perception, subjective knowledge acquisition, episodic memory retrieval with recency decay, character beliefs, and perspective isolation (Phase 6, ADR-014).

Phase 7 must give characters autonomous, persistent decision-making behavior governed by internal needs, short/long-term goals, personality values, and emotional state, while strictly enforcing simulation boundaries:
1. **Core Invariant:** $\mathbf{LLM\ proposes.\ Simulation\ Engine\ decides.\ Database\ records\ reality.\ Narrative\ presents\ reality.}$
2. **LLM & Cognition State Boundary:** Cognition logic and LLMs must never execute direct SQL or directly mutate authoritative state.
3. **Closed 29-Event Taxonomy:** No new event types may be introduced. Autonomous character actions and cognitive state mutations must project through the closed 29-event taxonomy established in Phase 4 (ADR-010/ADR-012).
4. **Subjective Perspective Boundary:** Deliberation must consume only what a character subjectively perceives, knows, remembers, and believes (non-omniscient context from Phase 6).
5. **Zero-SQL Replay Parity:** All cognitive state must be fully reconstructible in pure memory from the immutable event stream with zero SQL queries.

## Decision

### 1. Authoritative Cognition Persistence in SQLite (Migration 007)

Phase 7 introduces 5 dedicated runtime tables in SQLite (`PRAGMA user_version = 7`), protected by 15 database triggers and 10 indexes:
- `lws_character_needs`: 5 physiological and psychological needs (`energy`, `nourishment`, `social`, `safety`, `morale`) tracked with integer satisfaction in $[0, 100]$, decay rates in $[0, 1000]$, and timestamp tracking.
- `lws_character_goals`: Active, completed, suspended, and abandoned goals (`short_term`, `long_term`, `routine_override`, `acute_need`) with priority ($1..100$), urgency ($1..100$), progress ($0..100$), objective action types, and permanent uniqueness for non-null `client_goal_key` values via a non-partial unique index (`idx_lws_goals_char_client_key`).
- `lws_character_intentions`: Concrete action plans in status `active`, `executing`, `completed`, `failed`, or `cancelled`, tracking action types, target entities, rationale, attempt bounds, and structured failure/cancellation reasons.
- `lws_character_values`: 6 core personality dimensions (`honesty`, `courage`, `compassion`, `ambition`, `loyalty`, `curiosity`) with strength in $[-100, 100]$ enforcing character behavioral predispositions and moral vetoes.
- `lws_character_emotions`: Single dominant emotion (`neutral`, `joyful`, `fearful`, `angry`, `sad`, `surprised`, `disgusted`, `anxious`, `hopeful`) with intensity in $[0, 100]$, arousal in $[0, 100]$, valence in $[-100, 100]$, and hyperbolic decay ($\tau = 14400\,\text{s}$).

### 2. Subsystem Ownership Boundary (Phase 6 vs Phase 7)

A strict ownership and dependency boundary is maintained:
- **Phase 6 Owned Systems:** Spatial perception (`lws_event_perceptions`), subjective knowledge (`lws_character_knowledge`), episodic/semantic memories (`lws_character_memories`), beliefs/suspicions (`lws_character_beliefs`), and cameras (`lws_simulation_cameras`).
- **Phase 7 Integration:** Phase 7 does not recreate perception or memory; it consumes subjective perspectives via `src/living-world/perception/camera.js` (`buildSubjectivePerspective`) as non-omniscient input.
- **Phase 7 Owned Systems:** Needs, goals, intentions, personality values, emotions, deliberation scoring, and Tier 3 routine arbitration.

### 3. Pure Deterministic Deliberation & Composite Utility Scoring

Character deliberation (`deliberateCharacter`) evaluates candidate action proposals in pure memory without direct database writes:
1. **Candidate Generation:** Generates valid candidate proposals from active goals, acute needs, routines, and contextual opportunities from the 14 proposable character action types.
2. **Composite Utility Formulation:**
   $$U(a) = W_{\text{need}} \cdot S_{\text{need}}(a) + W_{\text{goal}} \cdot S_{\text{goal}}(a) + W_{\text{val}} \cdot S_{\text{val}}(a) + W_{\text{emo}} \cdot S_{\text{emo}}(a) - \text{Penalties}(a)$$
   where:
   - $S_{\text{need}}(a) = \sum \text{Relevance}(N_i, a) \cdot \frac{100 - \text{satisfaction}(N_i)}{100}$
   - $S_{\text{goal}}(a) = \text{GoalPriority} \cdot \text{Alignment}(G, a)$
   - $S_{\text{val}}(a) = \frac{1}{6} \sum \frac{\text{ValueStrength}(V_j) \cdot \text{Congruence}(V_j, a)}{100}$
   - $S_{\text{emo}}(a) = \frac{\text{Intensity}}{100} \cdot \text{Affinity}(E, a) + \frac{\text{Valence} \cdot \text{ActionValence}(a) + (\text{Arousal} - 50) \cdot (\text{ActionArousal}(a) - 50)}{200}$
   - $\text{Penalties}(a) = \text{TravelTimeCost}(a) + \text{ResourceDeficit}(a) + \text{ProcrastinationPenalty}(a)$
   - $\text{TravelTimeCost}(a) = \min(50, \text{round}(10 \cdot D(a)))$ where $D(a)$ is tree LCA distance derived via `getProposalTarget(a)`.
3. **Moral Veto:** If a candidate action produces severe negative congruence with an extreme positive personality value (e.g. deceptive communication with $\text{honesty} \ge +75$), a hard moral veto is applied, disqualifying the candidate regardless of utility.
4. **Deterministic Tie-Breaking:** Candidate selection uses stable ranking: $\text{Score DESC} \to \text{Category DESC} \to \text{SHA-256 TieBreakHash ASC}$.

### 4. Six-Tier Activity Arbitration Integration

Phase 7 activates Tier 3 `GOAL_PURSUIT` within the 6-tier routine arbitration hierarchy established in Phase 5:
- **Tier 1 — Director Override:** Unconditional director state manipulation.
- **Tier 2 — Interrupted:** Severe physical condition (`starving`, `exhausted`, `incapacitated`) suspends routines and travel.
- **Tier 3 — Goal Pursuit (Phase 7):** Active autonomous goal/intention pursuit during routine gaps (`routineBlock === null`) or when an acute goal preempts baseline activity.
- **Tier 4 — Travel:** Active in-transit spatial relocation.
- **Tier 5 — Routine:** Authored recurring daily schedule block.
- **Tier 6 — Idle:** Fallback activity when no routine, goal, or override applies.

### 5. Dual Sequence Model & Intention Lifecycles

To prevent sequence pollution from rejected in-memory candidates:
- `attemptIndex` is allocated only when a viable candidate is selected and dispatched to authority, deriving a deterministic intention UUID:
  $$\text{UUID} = \text{SHA-256}(\text{'intention'}, \text{sim\_lws\_id}, \text{char\_lws\_id}, \text{causal\_context}, \text{attemptIndex}, \text{action\_type})$$
- `proposalIndex` is reserved strictly for committed action events in the event ledger.

### 6. Failed Intentions Lifecycle (Option B)

In `/deliberate` execute mode, if authority evaluation rejects an action proposal (e.g., collocation failure, missing item, paused simulation):
1. Physical world state mutations are rolled back to savepoint `SAVEPOINT deliberate_authority_dispatch`.
2. The cognitive attempt is authoritatively committed via an `UPDATE_RUNTIME_STATE` event bearing `payload.cognition.failed_intention`.
3. This preserves pure zero-SQL replayability from `lws_events` while maintaining the closed 29-event taxonomy and preserving Phase 4 narrative-turn all-or-nothing savepoint semantics.

### 7. Authoritative Event Pipeline for Goal Mutations (P0-1 Correction)

Goal domain mutations are not permitted to bypass the event ledger. `createGoal()`, `updateGoal()`, and soft-deletion (`deleteGoal()`) issue no direct SQL mutations; they commit `UPDATE_RUNTIME_STATE` events with structured `payload.cognition` objects:
- `create_goal`: Processed by `applyStateTransition()` to insert `lws_character_goals` rows and folded in-memory by `simulationReducer()`.
- `update_goal`: Updates `lws_character_goals` attributes. When a goal is completed, abandoned, or soft-deleted (`is_deleted: true`), active and executing child intentions are automatically cancelled (`cancellation_reason = 'goal_completed' | 'goal_abandoned' | 'goal_deleted'`).

### 8. Exact 9-Route REST Transport Contract (P0-2 Correction)

The cognition REST API surface is mounted under `/api/living-world/simulations/:simLwsId/characters/:charLwsId/*` with exactly 9 endpoints:
1. `GET /cognition`: Aggregated cognition snapshot.
2. `GET /needs`: Current satisfaction and decay rates for all 5 needs.
3. `PUT /needs/:needName`: Update need decay rate.
4. `GET /goals`: List non-deleted goals.
5. `POST /goals`: Create goal via committed event.
6. `PATCH /goals/:goalLwsId`: Update goal or soft-delete (`{ is_deleted: true }`) via committed event.
7. `GET /intentions`: List character intentions.
8. `GET /values`: List 6 personality values.
9. `POST /deliberate`: Trigger cognitive deliberation loop (`preview` or `execute` mode).

*Soft-deletion is handled strictly via PATCH; direct DELETE on goals returns HTTP 404.*

### 9. Pure Zero-SQL Replay & Parity Engine

The in-memory simulation reducer (`simulationReducer` in `src/living-world/events/replay.js`) folds all Phase 7 cognition events (`SIMULATION_START`, `CHARACTER_JOIN`, physical actions with `payload.intention`, and `UPDATE_RUNTIME_STATE` with cognition payloads) in pure memory. Automated verification proves 100% tested field-level parity for the declared Phase 7 cognition state across the five cognition tables.

### 10. Non-Authoritative Domain Helper Distinction (`evaluateAcuteNeeds`)

`evaluateAcuteNeeds()` in `src/living-world/cognition/needs.js` is a retained direct-SQL domain helper currently reachable only from Phase 7 tests, with no observed production caller. Live simulation runtime handles acute needs dynamically in pure memory through `deliberation.js`. This helper must not be introduced into an authoritative production simulation execution path.

## Historical Correction Provenance

This ADR records the authentic historical development sequence:
1. **Initial Implementation (`e1709ce9ca17e44c592811a255e99de41263e009`):** Implemented Phase 7 schema, cognition modules, deliberation, and tests. Technical review discovered two P0 blockers: direct-SQL goal mutations in `goals.js` bypassing the event ledger, and an unapproved `DELETE /goals/:id` endpoint.
2. **Contract-Closure Correction (`f2212206a37d01885ac97cf538060fdcedfb14b1`):** Routed all goal mutations through `UPDATE_RUNTIME_STATE` cognition events, implemented pure in-memory replay folding for goals, removed the DELETE endpoint, updated parity verification, and verified 65/65 test suites (753/753 tests passing).
3. **Final Acceptance & Documentation Closure:** Subsystem engineering was accepted, verified on branch `release`, and closed in documentation.

## Consequences

### Positive
- Characters act autonomously and believably based on subjective needs, values, and emotions without granting the LLM direct database write authority.
- Replay from `lws_events` identically reproduces complete character cognition state in memory with zero SQL queries.
- Closed 29-event taxonomy is preserved with zero additions.
- Failed cognitive actions leave durable, replayable audit trails without polluting physical simulation state.

### Negative / Trade-offs
- Deliberation scoring requires evaluating multi-factor utility across viable candidate actions.
- Goal mutations require event commit overhead rather than direct single-table SQL writes.
