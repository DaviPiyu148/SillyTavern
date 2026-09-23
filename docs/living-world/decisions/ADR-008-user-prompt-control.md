# ADR-008: User System Prompts Are First-Class Configuration

## Status

Accepted

## Decision

Users can supply custom system prompts at supported scopes and may choose structured, raw, or hybrid prompt handling.

## Boundary

Custom prompts influence model behavior but do not directly bypass authoritative simulation state, validation, persistence, or security boundaries.
