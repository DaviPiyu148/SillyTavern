# ADR-002: LLM Is Not the Authority Over Simulation State

## Status

Accepted

## Decision

The LLM cannot directly mutate authoritative world/simulation state.

The required path is:

`LLM proposal → schema validation → domain validation → event/state transition → transaction commit`

## Reason

LLM output is probabilistic and may contain contradictions, hallucinations, malformed structures, or impossible physical/state transitions.

The platform's differentiator depends on persistent, inspectable world truth. That requires an authoritative non-LLM state layer.

## Consequences

The model must produce structured proposals for consequential state changes. The application must validate them before persistence.

Narrative prose is presentation, not authoritative state.
