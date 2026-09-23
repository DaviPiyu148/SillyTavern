# LWS Development Workflow

## Standard loop

```text
Understand
→ inspect repository
→ locate existing ST capability
→ define smallest coherent change
→ implement
→ test
→ verify
→ document
→ commit
```

## Understand

Read only the documents relevant to the task. Determine current behavior, desired behavior, invariants, affected boundaries, and acceptance criteria.

## Inspect

Search the actual repository before creating infrastructure. Ask whether ST already provides the API, storage/helper, UI primitive, generation seam, or lifecycle hook required.

## Reuse

Reuse matching ST infrastructure. Do not duplicate provider integrations, generic generation infrastructure, themes, modal systems, chat rendering, tokenization, or generic utilities.

## Define a coherent slice

Prefer a vertical slice that can be demonstrated end-to-end.

## Implement

Keep state boundaries explicit. Avoid speculative abstractions, god objects, direct SQL from UI, simulation logic in HTTP handlers, provider-specific domain dependencies, and direct LLM state mutation.

## Test and verify

Prove meaningful behavior, then verify original acceptance and adjacent behavior. Runtime UI changes require real UI verification when appropriate.

## Document

Update `PROJECT_STATE.md`, relevant architecture/domain docs, and `AI_CHANGELOG.md` for meaningful AI-agent changes. Durable architecture changes should have an ADR.

## Commit

Prefer small, coherent commits corresponding to verified slices.


## Phase completion

Do not advance to the next phase until the current phase is fully implemented and verified.

A partially implemented phase remains `IN PROGRESS` or `BLOCKED`; do not reclassify its unfinished scope as later-phase work without an explicit roadmap change.
