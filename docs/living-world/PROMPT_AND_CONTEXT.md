# LWS Prompt and Context System

## Goal

Give the model the context required for the current generation without making it authoritative or leaking hidden information.

## Core principle

```text
Simulation truth
→ permitted observation/knowledge
→ context selection
→ model generation
```

Never treat model narrative as the source of reality.

## Responsibility

LWS owns semantic context selection and knowledge filtering. SillyTavern owns provider/model connection, formatting, tokenizer/context mechanics, streaming, and existing generation settings.

## Conceptual prompt layers

1. LWS core simulation contract;
2. current simulation state;
3. world premise/rules;
4. author/style instructions;
5. character authored profile;
6. character runtime mind/state;
7. permitted relationships;
8. permitted perception/current scene;
9. relevant memories/knowledge;
10. recent causal events/history;
11. Director command;
12. output contract.

Not every generation uses every layer.

## User system prompts

ADR-008 makes custom system prompts first-class configuration. Do not simply discard them.

They may influence model behavior, but application code must enforce that they cannot mutate authoritative state, bypass validation/persistence, grant forbidden knowledge, or weaken security controls.

Prompt ordering is not a security boundary.

## Instruction roles

### Protected LWS contract
Defines the model role and non-negotiable semantic boundaries.

### Simulation context
Dynamic facts selected from authoritative state.

### Author/style instructions
User-controllable presentation/behavior preferences.

### Character/world source content
Imported or authored information interpreted through LWS normalization and knowledge rules.

### Director command
The current Observer/Director operation.

### Output contract
The structured proposal/narrative shape expected by the current operation.

## Hidden knowledge isolation

Example:

```text
World truth: John is in the basement.
Sarah's permitted knowledge: Sarah does not know John is in the basement.
```

Sarah's cognition context must not contain John's hidden location merely because the database knows it.

## Generation categories

## Implemented Prompt Architecture (Phase 10)

### 1. 12 Dynamic Layers & Priority Weights

| Layer # | Layer Key | Name | Priority | Trimming / Budget Behavior |
|---|---|---|---|---|
| 1 | `lws_system_contract` | LWS Protected Simulation Contract | 100 | Fixed (Never pruned) |
| 2 | `simulation_state` | Simulation State & Environment | 70 | High priority |
| 3 | `world_premise_rules` | World Premise & Rules | 55 | Medium priority |
| 4 | `style_and_author_instructions` | Author & Style Instructions (+ User Prompt) | 60 | Medium priority |
| 5 | `character_authored_profile` | Character Authored Profile | 75 | High priority |
| 6 | `character_mind_state` | Character Mind & Runtime State | 80 | High priority |
| 7 | `permitted_relationships` | Permitted Relationships (Outgoing only) | 40 | Elastic (Pruned 3rd) |
| 8 | `permitted_perception_scene` | Permitted Perception & Current Scene | 50 | Medium priority |
| 9 | `relevant_memories_and_knowledge`| Subjective Memories & Beliefs | 30 | Elastic (Pruned 2nd) |
| 10 | `recent_causal_events` | Recent Perceived Events | 20 | Elastic (Pruned 1st) |
| 11 | `director_instruction_or_user_prompt` | User Input / Scene Prompt | 90 | Fixed (Never pruned) |
| 12 | `output_contract` | Output Contract Instructions | 95 | Fixed (Never pruned) |

### 2. Generation Modes & Output Contracts

- **`character_dialogue`**: Standard interactive roleplay turn. Uses `dual_block` output contract (`<lws_proposal>...JSON...</lws_proposal>` + narrative prose).
- **`character_decision`**: Autonomous planning and action selection. Uses `structured_proposal` output contract (pure JSON event proposal).
- **`world_narration`**: Camera / third-person scene narration. Uses `narrative_prose` output contract (pure narrative without JSON blocks).
- **`director_query`**: Objective simulation status query and inspection. Uses `director_report` output contract.

### 3. Token Budgeting & Layer Trimming

- Token counts are estimated deterministically (~3.8 characters per token, 1.3 words per token).
- When total prompt tokens exceed `maxTokens`, layers with priority $< 90$ are truncated line-by-line or pruned in ascending priority order.
- Fixed layers (`lws_system_contract`, `output_contract`, `director_instruction_or_user_prompt`) are never pruned.
- System prompt, user prompt, and chat messages are dynamically re-assembled after trimming, with full budget metadata attached.

### 4. Output Parsing & 2-Transaction Savepoint Execution

```text
LLM Generation Output
→ parseModelResponse (extracts <lws_proposal> tags, code fences, clean prose)
→ executeNarrativeTurn
    → Transaction A: Insert pending turn in lws_narrative_turns
    → Transaction B: SAVEPOINT proposal_batch
        → 4-Stage Authority Evaluation (Stage 1-3)
        → Monotonic Event Ledger Commit (Stage 4)
        → Success: RELEASE proposal_batch, mark turn 'committed'
        → Failure: ROLLBACK TO proposal_batch, RELEASE proposal_batch, mark turn 'rejected' with error_details
```

### 5. Long-term Continuity

Do not use the model context window as the character's database. Persistent facts live in LWS persistence and are retrieved when relevant.
