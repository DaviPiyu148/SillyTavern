# ADR-005: Generic OpenAI-Compatible Model Gateway

## Status

Accepted

## Decision

The v0.1 application integrates with one generic OpenAI-compatible inference contract.

## Reason

This maximizes compatibility with local and remote inference servers without forcing the application to manage model installation, downloading, or hardware acceleration.

## Consequences

Provider-specific features should not leak into the core domain unless intentionally abstracted.
