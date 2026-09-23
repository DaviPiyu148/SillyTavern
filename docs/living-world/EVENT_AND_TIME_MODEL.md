# LWS Event and Time Model

## Event authority

`SimulationEvent` is an immutable authoritative fact after commit.

`NarrativeTurn` is an audit/presentation wrapper around one Director interaction or generation. It can reference proposed/committed event IDs, raw model output, parsed narrative, model identity, and validation/commit status.

Narrative is not the event ledger.

## Chronology vs causality

Fictional time answers when. Causality answers why/what depends on what. Multiple events may share a fictional timestamp; sequence numbers and causal edges disambiguate order.

## Event-driven progression

Simulation advances on requested operations rather than wall-clock ticks. A `TIME_ADVANCE` may cause scheduled triggers, routine activity changes, travel/movement, environmental effects, recovery/fatigue, goal pursuit, resource consumption, interruptions, and other deterministic consequences.

## Deterministic candidate generation

Preserve the accepted ADR-010 principles: deterministic candidate generation and ordering, validated proposal staging order, causal DAG dependencies, Kahn topological scheduling, monotonic fictional timestamps, and immutable committed sequence numbers for replay.

Do not reintroduce random UUID ordering as a hidden tie breaker.

## Causal DAG

Dependencies include, where applicable:

```text
proposal P0 → P1 → P2 ...
movement → resulting activity update
all sub-events → enclosing TIME_ADVANCE completion
```

Rejected prerequisites invalidate dependent events that cannot stand alone. Independent valid events may still commit according to the current batch policy.

## Activity arbitration

Preserve the accepted hierarchy:

```text
DIRECTOR_OVERRIDE
→ INTERRUPTED / severe condition
→ GOAL_PURSUIT
→ TRAVEL
→ ROUTINE
→ IDLE
```

A severe condition can suspend an active override and allow resumption when conditions clear if the remaining operation still permits it.

## Scheduled events

Use the accepted lifecycle concept:

```text
PENDING
→ TRIGGERED
→ CANCELLED
→ SUPERSEDED
```

Terminal transitions are immutable. Preserve participant referential integrity and supersession/cancellation provenance.

## Fictional timestamps

The accepted canonical serialized format is:

```text
YYYY-MM-DDTHH:MM:SSZ
```

Here `Z` is a lexical delimiter for the fictional timestamp representation, not an Earth timezone semantic.

## Travel

Travel consumes fictional time and may depend on route, distance, transport, terrain, weather, traffic, access restrictions, capability, and interruptions/delays.

Do not use instantaneous graph movement merely because older reference text described it that way.

## Deterministic consequences

Where a rule is known, consequences should be deterministic, e.g. rain + outdoors → wetness; exertion → fatigue; resource use → inventory change; injury → pain/limitation; travel → elapsed time.

## Replay

For event-sourced areas, replay folds committed immutable events and does not invoke the LLM. The event sequence is the replay authority.
