# ADR-009: Normalize External Content Without Losing Source Provenance

## Status

Accepted

## Decision

Imported/freeform content may be AI-normalized into canonical structures, but the original source remains preserved and normalized values must retain provenance where practical.

## Reason

External AI-RP content is often messy and inconsistent. Users need convenience without losing control or silently accepting hallucinated transformations.

## Consequences

The import pipeline requires source storage, normalization metadata, conflict detection, and a review step for ambiguous cases.
