# LWS Testing

## Goal

Demonstrate that LWS behaves like a persistent world simulator. Avoid coverage theater.

## Test layers

### Domain

Prove invariants such as invalid transitions rejected, authored/runtime separation, directional relationships, temporal travel, causal development, and perception/knowledge boundaries.

### Simulation

Prove deterministic consequences, time advance, schedules/routines, activity arbitration, travel, population emergence, event ordering, and proposal rejection/partial semantics where applicable.

### Persistence/replay

Prove durability across restart, event persistence, replay parity, no LLM calls during replay, and agreement between live state and replayed state.

### Integration

Prove LWS API behavior through the ST server, character import, generation integration through ST, and rejection of invalid proposals.

### Frontend/e2e

When a real UI path is affected, verify an actual workflow such as:

```text
Open ST
→ Living World
→ world
→ characters
→ scenario
→ initialize
→ observe
→ follow Dave
→ advance time
→ verify narrative/state
→ reload
→ verify persistence
```

## Critical scenarios

### Long-term continuity

Charlotte starts a trip, time advances through unrelated events, she reaches an intermediate location, many turns later her goal/activity/memory/state remains coherent.

### Off-camera world life

Follow Dave, advance time, and verify Charlotte still executes scheduled/goal-driven world behavior.

### Knowledge isolation

Create a hidden fact, verify Sarah's cognition context excludes it, and separately verify authorized Observer inspection can see truth.

### Gas-station population

Route Charlotte through a gas station, resolve contextual workers/customers/vehicles, keep most entities ambient, and promote a repeatedly relevant NPC when warranted.

### Authored/runtime isolation

Run the same authored character in two simulations and change runtime state in only one; verify the definition and other simulation remain unchanged.

### Replay parity

Execute a deterministic scenario, save committed events, replay, compare state, and verify no LLM invocation is necessary.

## Regression rule

Every root-cause bug should gain a focused regression test unless technically impossible; explain exceptions.

## Verification claims

Report the exact command/check, result, scope, and limitations. Do not call something tested merely because a test file exists.


## Phase-level acceptance

Tests are organized to prove the active phase as a whole.

A passing subset of features inside a phase does not make the phase complete. Phase completion requires the full acceptance criteria in `PHASE_DEVELOPMENT_PLAN.md` to be demonstrably satisfied.

Browser verification is prohibited for this project.
