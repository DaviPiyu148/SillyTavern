# LWS Simulation Model

## World

A World is the authored universe/stage: metadata, premise/setting, world rules, calendar/time configuration, authored Characters, Locations, Factions, Lore/World Info, Scenarios, prompt/style configuration, assets and related authored content.

The World is reusable.

## Character

A Character is an authored identity/profile containing, as applicable: identity, appearance, personality, values, strengths/flaws, fears, habits, background, baseline goals, speech/style, baseline knowledge, secrets, routine, and examples.

It is not runtime state.

## SimulationCharacter

A SimulationCharacter is the runtime representation of an authored character in one simulation. Runtime state can include location, physical condition, needs, energy/fatigue, emotion, current activity, goals/priorities, inventory/resources, beliefs, knowledge, memories, relationships, current plans/intention, routine state, development state, and travel state.

## Locations

Locations may be hierarchical:

```text
World → Region → City → District → Building → Floor → Room
```

A location may also have occupancy, access, doors/windows/barriers, lighting, terrain, environmental state, and active entities.

## Scenario initialization

Example:

> Dave, Charlotte, and Tom are a family living in Austin, Texas. Charlotte decides to go to the beach on Sunday morning.

Initialization should establish initial state, activities/goals, location assignments, relevant relationships/knowledge, scheduled/routine behavior, and then an opening narrative/greeting.

The greeting is downstream of initialized state. It does not define reality.

## Runtime loop

```text
Current state
→ requested operation
→ deterministic consequences / scheduled work
→ character decision/cognition where needed
→ proposed events
→ validation
→ commit
→ new state
→ observation
→ narrative
```

## Character cognition

A character's cognition combines current state, needs, goals, values, beliefs, memories, relationships, emotion, personality, environment, perception, and available actions.

The LLM may assist with intent, decisions, dialogue, and interpretation. Deterministic rules remain authoritative.

## Memory

Memory is persistent, subjective, and bounded. It may include subject, event/provenance, time, emotional salience, confidence, distortion/status, and source/channel.

Do not dump all memory into every generation; retrieve relevant memories.

## Development

```text
Event
→ Perception
→ Interpretation
→ Emotion
→ Memory
→ Belief/meaning
→ Repeated pressure
→ Disposition/value/goal/habit change
→ Behavior
```

## Emergent world

A gas station may have a persistent manager, a supporting clerk, ambient customers/drivers/delivery workers/vehicles, and other contextual entities. Repeatedly relevant ambient entities can become persistent.

## Observer and camera

The Observer may follow a character, observe a location, inspect state, advance time, and issue Director commands. Camera focus is not simulation focus.

`FOLLOW_DAVE` means “present Dave-centered observation,” not “stop simulating everyone else.”
