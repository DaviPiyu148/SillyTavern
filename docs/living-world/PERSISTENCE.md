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
