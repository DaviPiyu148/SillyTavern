# ADR-006: Separate Authored Definitions from Runtime State

## Status

Accepted

## Decision

Reusable authored entities and simulation runtime state are separate data domains.

Examples:

`Character` is authored/reusable.

`SimulationCharacter` is mutable and simulation-specific.

## Reason

The same character and world may participate in multiple independent timelines. Runtime changes in one timeline must not corrupt authored definitions or another simulation.
