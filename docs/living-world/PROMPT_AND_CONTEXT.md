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

### Character decision
Needs needs, goals, values, beliefs, memories, perception, environment, and options/constraints.

### Dialogue/narrative
Needs character identity, current mind state, perception, relationships, relevant memories, scene, and recent events.

### Director OOC query
May use authorized simulation truth and event history.

### World narration
Uses camera/observation scope and authorized event/environment context.

## Consequential output

```text
LLM output
→ parse
→ schema validate
→ domain validate
→ commit accepted events
→ generate final narrative from committed reality
```

## Long-term continuity

Do not use the model context window as the character's database. Persistent facts live in LWS persistence and are retrieved when relevant.
