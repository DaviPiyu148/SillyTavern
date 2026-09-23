# Current Architecture Reconciliation

## Purpose

The original LWS ADR set was written for a standalone local-first modular monolith. The current product decision is to implement LWS natively inside the user's SillyTavern fork.

The architectural principles remain useful; the original application stack is not the current implementation target.

## What remains authoritative from the ADR set

- local-first, modest-resource orientation;
- modular monolith;
- SQLite for v0.1;
- LLM is not the authority over simulation state;
- event-driven/on-demand simulation;
- authored data separated from mutable runtime state;
- causal persistent character development;
- user prompts are first-class configuration within application-enforced boundaries;
- provenance-preserving normalization;
- deterministic scheduling, causal ordering, and replay.

## What is superseded for the current implementation

ADR-001 names React + TypeScript + Vite, FastAPI/Python, SQLite, and a generic OpenAI-compatible model endpoint.

For the current fork these are replaced by:

- SillyTavern's existing frontend/runtime as the host;
- SillyTavern's Node.js server/runtime as the host;
- LWS-specific native modules under a clearly isolated namespace;
- SillyTavern's existing generation/provider infrastructure as the host integration surface;
- SQLite remains the LWS v0.1 persistence choice.

Do not recreate the old standalone React/FastAPI application.

## Repository integration rule

LWS should be recognizable as a subsystem:

```text
SillyTavern
├── existing platform
└── native LWS subsystem
```

The LWS core should depend on domain/application contracts, not on scattered SillyTavern implementation details. SillyTavern-specific adaptation belongs at the integration boundary.

## Travel clarification

Older reference material described instantaneous/topological movement. The current product decision is that travel consumes fictional time and is affected by route, transport, terrain, weather, access, and interruption where modeled.

The deterministic ordering and replay requirements from ADR-010 remain applicable.

## Prompt clarification

ADR-008 keeps user system prompts first-class. LWS therefore must not simply delete or prohibit custom system prompts. Instead:
- user prompts may shape model behavior;
- application code remains authoritative over simulation state;
- prompt text cannot grant forbidden knowledge, directly mutate state, bypass validation, or weaken security controls.

The application must enforce these boundaries rather than relying on prompt precedence alone.
