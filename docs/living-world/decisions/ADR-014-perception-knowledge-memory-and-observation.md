# ADR-014: Perception, Knowledge, Memory, and Observation

## Status

Accepted

## Context

In Phase 5, Living World Simulator (LWS) established authoritative temporal progression, 6-tier routine arbitration, spatial travel consuming fictional time, scheduled world events with reciprocal supersession, and zero-SQL pure replay parity. However, character perception, subjective knowledge, memory formation with relevance decay retrieval, character beliefs/suspicions, and observer perspectives remained unmodeled.

To fulfill Domain Rules 6 (Knowledge is filtered by what a character could actually know), 7 (Camera changes what is presented, not what exists), 9 (Persistent character development requires causal evidence), and ADR-002 / ADR-007, LWS requires:
1. Spatial sensory perception mechanics evaluating physical reachability across tree hierarchy distance.
2. Canonical sensory modality precedence (`tactile > visual > auditory > olfactory`) with strict single-modality persistence per `(event, character)` perception.
3. Subjective character knowledge acquisition with deterministic causal provenance tracking.
4. Character episodic/semantic memory persistence with relevance-bounded retrieval ($N \le 100$ candidate bound, $\tau = 604800\,\text{s}$).
5. Character beliefs and suspicions support ($1 \le \text{confidence} \le 100$) via `DIRECTOR_MODIFY_STATE` and event payloads.
6. Multi-mode simulation camera tracking (`follow_character`, `observe_location`, `god_view`) with privileged Observer Perspective and non-omniscient character perspective rendering.
7. Pure in-memory zero-SQL replay engine parity across all Phase 6 tables with deterministic SHA-256 identity derivation.

## Decision

We adopt an **Authoritative Perception, Knowledge, Memory, and Observation Architecture**:

1. **Spatial Sensory Perception Engine & In-Fiction Modalities**:
   - Every committed event in `internalCommitEvent` evaluates spatial perception for all active simulation characters within the atomic transaction.
   - Spatial perception distance is determined using hierarchical tree Lowest Common Ancestor (LCA) distance:
     $$d = \text{depth}(A) + \text{depth}(B) - 2 \cdot \text{depth}(\text{LCA})$$
   - Sensory reach thresholds:
     - `tactile`: $d = 0$ (same exact location) and event involves character directly as actor or target.
     - `visual`: $d \le 1$ (same location or immediate sibling/parent-child boundary).
     - `auditory`: $d \le 2$.
     - `olfactory`: $d \le 1$.
   - **Option A Canonical Modality Precedence**: Exactly one canonical sensory modality is persisted per `(event, character)` in `lws_event_perceptions`, adhering to:
     $$\text{tactile} \succ \text{visual} \succ \text{auditory} \succ \text{olfactory}$$
   - `omniscience_director` is strictly prohibited from storage in `lws_event_perceptions` (only in-fiction physical modalities are stored).

2. **Subjective Knowledge & Causal Evidence**:
   - Character knowledge is persisted in `lws_character_knowledge` (`schemaVersion = 6`).
   - Ordinary perception does not fabricate facts. Structured perceived facts (`perceived_facts`, `observed_facts`, `discovered_facts`, `facts`) explicitly create knowledge with complete causal provenance (`source_channel`, `source_character_id`, `source_event_id`, `fictional_time_acquired`).
   - Soft-delete semantics (`deleted_at`) preserve history while removing facts from active context.

3. **Character Memories & Relevance Scoring**:
   - Persisted in `lws_character_memories`.
   - Supports episodic, semantic, and backstory memories linked directly to causal events.
   - Candidate pre-filtering is bounded to $N \le 100$ records via index `idx_lws_memories_char_salience`.
   - Multi-factor relevance scoring for memory retrieval:
     $$S_{\text{total}} = 0.25 \cdot S_{\text{recency}} + 0.25 \cdot S_{\text{salience}} + 0.20 \cdot S_{\text{importance}} + 0.30 \cdot S_{\text{context}}$$
     where $\text{Recency} = \frac{1}{1 + \frac{\Delta t}{604800}}$ ($\Delta t = \text{secondsBetween}(M.\text{fictional\_time}, T_{\text{now}})$, $\tau = 604800\,\text{s}$).
   - Deterministic tie-breaking: $S_{\text{total}}$ DESC, $M.\text{fictional\_time}$ DESC, $M.\text{lws\_id}$ ASC.
   - Director patches allow mutating only allowed fields (`summary`, `details`, `emotional_salience`, `importance`, `confidence`, `status`, `tags`, `deleted_at`), preserving immutable causal identities.

4. **Character Beliefs & Suspicions**:
   - Persisted in `lws_character_beliefs` with schema fields: `subject_key`, `belief_type`, `statement`, `confidence`, `source_basis`, `causal_event_id`, `deleted_at`.
   - Valid confidence integer range: $1 \le \text{confidence} \le 100$.
   - Mutated authoritatively via `DIRECTOR_MODIFY_STATE` and event payloads.

5. **Simulation Cameras & Observer Perspectives**:
   - Persisted in `lws_simulation_cameras` with immutable `camera_name` and `simulation_id`.
   - Supports modes: `follow_character`, `observe_location`, `god_view`.
   - **Privileged Observer Perspective** (`GET /api/living-world/simulations/:simLwsId/observer/perspective`): Returns omniscient ground truth directly from simulation state without creating character perception rows.
   - **Subjective Perspective** (`GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/perspective`): Returns strictly non-omniscient character perspective filtered by perceptions, active knowledge, recent memories, and current beliefs.

6. **Deterministic Identity Derivation & Zero-SQL Pure Replay**:
   - Derived rows (`perceptions`, `knowledge`, `memories`, `beliefs`, default `camera`) generate stable deterministic UUIDs using SHA-256 namespace hashing (`generateDeterministicUuid(namespace, ...parts)`).
   - Pure in-memory replay reducer (`simulationReducer`) folds all Phase 6 events with zero database queries, achieving 100% attribute parity with SQLite.

7. **REST Transport**:
   - Exactly 13 dedicated Phase 6 endpoints mounted under `/api/living-world/simulations/:simLwsId/*`.

## Consequences

- Closed 29-event taxonomy is preserved with zero additions.
- Database version advances to `PRAGMA user_version = 6` with 5 new tables, 15 triggers, and 10 indexes.
- Full parity between database execution and in-memory replay is guaranteed.
