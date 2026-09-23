# ADR-003: SQLite for v0.1 Persistence

## Status

Accepted

## Context

The product is local-first, single-user by default, intended to run on modest computers and support Termux-oriented deployment.

## Decision

Use SQLite for v0.1.

## Reason

SQLite avoids requiring a separate database server and produces a portable local data file while providing transactions, indexes, constraints, and mature relational behavior.

## Consequences

The schema must be designed carefully around SQLite concurrency and migration limitations. A future server-scale deployment may introduce another storage adapter if real requirements appear.
