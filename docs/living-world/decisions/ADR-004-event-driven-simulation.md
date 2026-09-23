# ADR-004: Event-Driven On-Demand Simulation

## Status

Accepted

## Decision

The default simulation is advanced only when the Observer requests an operation. Routine deterministic behavior is resolved without unnecessary LLM calls. Meaningful uncertainty triggers LLM reasoning where useful.

## Reason

The product targets weak hardware and does not need a permanently running world in the default mode. An event-driven approach also makes persistent state and provenance easier to inspect.

## Consequences

The platform must model schedules, routines, time jumps, and important events without requiring continuous simulation ticks.
