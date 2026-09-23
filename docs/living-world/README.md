# Living World Simulator (LWS) — AI Agent Documentation

This directory is the working documentation boundary for the Living World Simulator (LWS) inside the `DaviPiyu148/SillyTavern` fork.

## Start here

1. Read the repository-root `AGENTS.md`.
2. Read `DOCUMENTATION_INDEX.md`.
3. Read `PROJECT_STATE.md`.
4. Read the specialized document(s) relevant to the task.
5. Inspect the actual repository before changing code.

## Documentation authority

The documents in this directory describe the current intended architecture and engineering workflow. The ADRs in `decisions/` preserve the accepted architectural decisions and their rationale.

When an older ADR or reference document conflicts with a newer explicit product decision recorded in current documentation, use the current reconciled architecture and preserve the ADR's historical rationale rather than silently reviving the superseded implementation.

## Core product invariant

> The LLM proposes cognition, decisions, and narrative. The simulation system decides authoritative reality. Persistence records reality. Narrative presents reality.
