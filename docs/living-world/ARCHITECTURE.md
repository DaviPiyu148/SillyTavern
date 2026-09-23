# LWS Architecture

## 1. Product architecture

LWS is a native subsystem inside the SillyTavern fork.

```text
SillyTavern
├── Normal SillyTavern capabilities
└── Living World subsystem
    ├── authoring
    ├── simulation
    ├── events/time
    ├── cognition/context
    ├── observation/director
    ├── persistence/replay
    ├── import/normalization
    └── SillyTavern integration
```

There is one application/runtime. Do not introduce a separate LWS web app or server.

## 2. Responsibility boundary

### SillyTavern provides

- existing application/runtime lifecycle;
- existing character-card infrastructure;
- existing World Info/lorebook infrastructure;
- model/provider connections;
- generation pipeline and model formatting;
- tokenization/context utilities;
- streaming;
- chat/narrative rendering where reusable;
- existing UI language, drawers, popups, controls, themes, responsive behavior;
- existing authentication/session infrastructure;
- existing extension/plugin infrastructure where integration helpers are useful.

### LWS owns

- world/simulation domain semantics;
- authoritative simulation state;
- simulation events and causal history;
- fictional time;
- schedules/routines/world-life;
- temporal travel;
- perception and knowledge isolation;
- memory;
- relationships/factions;
- character development;
- dynamic population;
- Director commands;
- camera/observation semantics;
- LWS prompt/context selection;
- LWS validation;
- LWS persistence/replay;
- LWS import normalization.

## 3. Core invariant

```text
LLM proposes
→ LWS validates
→ simulation decides
→ transaction commits
→ narrative presents committed reality
```

Narrative is never the authoritative source of reality.

## 4. Layering

Use actual cohesion rather than creating a directory per conceptual subsystem.

```text
API/UI
  ↓
Application services
  ↓
Domain / simulation rules
  ↓
Persistence + integration adapters
```

Cross-cutting concerns such as validation, observability, and serialization should be kept at the appropriate boundary rather than copied across features.

## 5. Core runtime loop

```text
Director command / generation request
        ↓
Command interpretation
        ↓
Simulation state evaluation
        ↓
Time/event/consequence processing
        ↓
Observation/perception filtering
        ↓
Context selection
        ↓
SillyTavern generation pipeline
        ↓
LLM proposal / cognition / narrative
        ↓
Parse + schema validation
        ↓
Domain validation
        ↓
Event/state commit
        ↓
Observation/narrative presentation
```

Not every user interaction requires an LLM. Deterministic simulation handles deterministic work.

## 6. Multiple simulations

The same authored World and Character can participate in multiple simulations. Mutable runtime state must be scoped to a simulation.

## 7. Camera and observation

The camera is an Observer concern. Following Dave does not stop Charlotte or Tom from living.

## 8. Prompt boundary

LWS controls semantic context: what the model needs and is permitted to know. SillyTavern controls the mechanics of sending the generation request.

## 9. Population model

Use population tiers:
- Core: rich persistent state;
- Supporting: persistent but lighter state;
- Ambient: temporary contextual entities that can be promoted when repeatedly relevant.

Do not materialize an entire city as thousands of fully simulated characters.

## 10. Repository design principle

The repository must stay boring and discoverable. Prefer one dedicated LWS namespace, thin ST integration points, cohesive modules, small application boundaries, and tests in the LWS namespace. Avoid scattering LWS conditionals through unrelated ST features, parallel implementations of ST infrastructure, speculative microservices, and premature abstractions.
