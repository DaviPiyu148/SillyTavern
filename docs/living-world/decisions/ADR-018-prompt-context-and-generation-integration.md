# ADR-018: Prompt, Context, Perspective Isolation, and SillyTavern Generation Integration

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 10)

## Context

In the Living World Simulator (LWS), the simulation engine is the single authoritative source of truth. LLMs are generative actors, not state arbiters:
$$\mathbf{LLM/User\ proposes \to Simulation\ Engine\ decides \to Database\ records\ reality \to Narrative\ presents\ reality}$$

Prior phases established the complete systemic simulation layer:
- Authored models, simulations, and snapshots (Phases 1–3).
- Authoritative event ledger, 4-stage authority pipeline, and closed 29-event taxonomy (Phase 4).
- Deterministic temporal progression, schedules, routines, and spatial travel (Phase 5).
- Spatial perception, subjective knowledge, episodic memory, and observer perspectives (Phase 6).
- Autonomous cognition, need systems, values, emotions, and decision deliberation (Phase 7).
- Social systems, asymmetric relationships, rumors, factions, and causal development (Phase 8).
- Tri-tier population, ambient emergence, environmental dynamics, and operational states (Phase 9).

Phase 10 completes the generative bridge between SillyTavern and the LWS simulation:
1. **Zero-Omniscience Perspective Isolation:** Prompts for character perspectives contain only what the character has perceived, remembered, or believes. Private beliefs of other characters, unperceived events, distant entities, and third-party social matrices (e.g. $B \to C$) are strictly excluded.
2. **12-Layer Dynamic Context Architecture:** Context is assembled into 12 structured layers accommodating the simulation contract, environment, world premise, style instructions, character mind state, permitted relationships, visible scene entities, subjective memories, recent perceived events, user input, and output contracts.
3. **User Prompt & Style Control (ADR-008):** Custom user system prompts and world prompt configurations are first-class prompt inputs that shape style, tone, and pacing, but cannot bypass application-enforced simulation, validation, or persistence boundaries.
4. **Token Budgeting & Graceful Trimming:** Deterministic token estimation with priority-based layer trimming prunes elastic layers (recent events, memories, relationships) before touching core identity layers, while fixed layers (system contract, output contract, user prompt) are never pruned.
5. **Dual-Block Output Parsing:** Robust extraction of structured event proposals (`<lws_proposal>...</lws_proposal>` and fenced code blocks) alongside clean narrative prose.
6. **2-Transaction Savepoint Execution:** Proposals are executed through `executeNarrativeTurn` under `SAVEPOINT proposal_batch`. Successful proposals commit state; invalid proposals roll back to the savepoint and record the turn as rejected without database corruption.
7. **SillyTavern Integration:** Reuses native SillyTavern provider infrastructure and endpoints without duplicating generation engines.

---

## Decision

### 1. Generation Modes & Output Contracts

Four distinct generation modes are supported across prompt assembly and execution:
- `character_dialogue`: Standard multi-turn interactive dialogue; generates conversational responses and optional consequential action proposals using the `dual_block` contract.
- `character_decision`: Action selection and deliberative planning; produces structured event proposals using the `structured_proposal` contract.
- `world_narration`: Third-person observer or camera perspective narrative; produces descriptive prose using the `narrative_prose` contract.
- `director_query`: Objective simulation inspection and status summarization using the `director_report` contract.

### 2. 12-Layer Dynamic Context Structure

Context assembly constructs 12 conceptual layers mapped to priority weights:

| Layer # | Identifier | Name | Priority | Pruning Behavior |
|---|---|---|---|---|
| **Layer 1** | `lws_system_contract` | LWS Protected Simulation Contract | 100 | **Fixed** (Never pruned) |
| **Layer 2** | `simulation_state` | Simulation State & Environment | 70 | High priority |
| **Layer 3** | `world_premise_rules` | World Premise & Rules | 55 | Medium priority |
| **Layer 4** | `style_and_author_instructions` | Author & Style Instructions (+ User Prompt) | 60 | Medium priority |
| **Layer 5** | `character_authored_profile` | Character Authored Profile | 75 | High priority |
| **Layer 6** | `character_mind_state` | Character Mind & Runtime State | 80 | High priority |
| **Layer 7** | `permitted_relationships` | Permitted Relationships (Outgoing only) | 40 | Elastic (Pruned 3rd) |
| **Layer 8** | `permitted_perception_scene` | Permitted Perception & Current Scene | 50 | Medium priority |
| **Layer 9** | `relevant_memories_and_knowledge`| Subjective Memories & Beliefs | 30 | Elastic (Pruned 2nd) |
| **Layer 10**| `recent_causal_events` | Recent Perceived Events | 20 | Elastic (Pruned 1st) |
| **Layer 11**| `director_instruction_or_user_prompt` | User Input / Scene Prompt | 90 | **Fixed** (Never pruned) |
| **Layer 12**| `output_contract` | Output Contract Instructions | 95 | **Fixed** (Never pruned) |

### 3. Strict Perspective Isolation Invariants

- **Actor / Target Identification:** Character resolution seamlessly supports both authored character UUIDs (`c.lws_id`) and runtime simulation character UUIDs (`sc.lws_id`).
- **Co-Located Scene Entities:** Only characters sharing the same `current_location_id` are included in visible entity perception.
- **Outgoing Social Matrix:** Character $A$ only receives outgoing relationships ($A \to B$, $A \to C$). Third-party relationships ($B \to C$) are strictly omitted.
- **Private Knowledge & Beliefs:** Private thoughts, unshared beliefs, and unperceived events of other characters are excluded from perspective prompts.
- **Sensory Clarity Modulation:** Environmental sensory clarity ($0..100$) derived from lighting, weather, noise, air quality, and crowd density modulates perceptual detail.

### 4. Token Budgeting & Layer Trimming

- Token estimation uses deterministic character/word boundary heuristics (~3.8 characters per token, 1.3 words per token).
- When prompt size exceeds `maxTokens`, prunable layers (priorities $< 90$) are truncated line-by-line or removed in ascending priority order.
- Prompts and chat messages are reassembled dynamically after trimming, and budget metadata (`total_estimated_tokens`, `max_tokens`, `truncated`, `pruned_layers`) is attached to the context.

### 5. Output Parsing & Savepoint Pipeline

- Raw LLM responses are parsed by `parseModelResponse()` to extract `<lws_proposal>` tags, markdown fenced JSON blocks, or direct JSON payloads, while stripping structured blocks to yield clean `narrative_prose`.
- Proposals pass to `executeNarrativeTurn()` using a 2-transaction savepoint model:
  - **Transaction A:** Creates a pending row in `lws_narrative_turns`.
  - **Transaction B:** Executes proposal batch under `SAVEPOINT proposal_batch`.
    - On success: Releases savepoint, commits all events through the 4-stage authority pipeline, and marks turn as `committed`.
    - On validation/authority failure: Rolls back to savepoint, preserves the database without partial state corruption, and marks turn as `rejected` with structured error details.

### 6. REST API Endpoints

- `POST /api/living-world/simulations/:simLwsId/prompt-context/build`: Assembles layered prompt context and applies token budgeting for inspection or preview.
- `POST /api/living-world/simulations/:simLwsId/generate`: Orchestrates full turn generation, proposal parsing, and savepoint state execution.

---

## Verification & Parity

Phase 10 is verified with 6 dedicated test suites:
1. `tests/living-world/lws-prompt-context-builder.test.js`: 12-layer context assembly and mode adaptation.
2. `tests/living-world/lws-prompt-knowledge-isolation.test.js`: Anti-omniscience, co-location boundaries, and private belief protection.
3. `tests/living-world/lws-token-budgeting.test.js`: Deterministic token estimation, budget allocation, and priority layer pruning.
4. `tests/living-world/lws-output-parser.test.js`: XML proposal tags, markdown fences, JSON normalization, and error resilience.
5. `tests/living-world/lws-generation-pipeline.test.js`: End-to-end turn generation, valid proposal execution, pure narrative turns, and savepoint rollback on rejection.
6. `tests/living-world/lws-prompt-api.test.js`: HTTP endpoints for prompt context building and simulation generation.

**Repository Test Status:**
- Dedicated Phase 10: 22/22 passing
- Living World Subsystem: 459/459 passing (69 test suites)
- Full Repository: 870/870 passing (88 test suites)
