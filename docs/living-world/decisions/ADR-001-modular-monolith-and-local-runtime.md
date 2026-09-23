# ADR-001: Modular Monolith and Local Runtime

## Status

Accepted

## Context

The project targets local-first operation on modest hardware, including Termux-oriented Android use. The first release does not require distributed operation, multi-user cloud infrastructure, or continuous background processing.

## Decision

Use a modular monolith with:

- React + TypeScript + Vite frontend
- FastAPI/Python backend
- SQLite persistence
- local file storage for binary assets
- generic OpenAI-compatible model endpoint

## Consequences

### Positive

- simple installation
- low resource overhead
- easy debugging
- portable local data
- easier AI-agent-driven development
- fewer operational failure modes

### Negative

- some future scaling patterns are postponed
- process-level isolation is limited
- larger future workloads may require architectural evolution

## Revisit When

Introduce additional services only when measured requirements justify them.
