# Tooling and Skills

## Core routing

### Planning
Use `planning-and-task-breakdown`, `spec-driven-development`, and `context-engineering`.

### Architecture/API
Use `api-and-interface-design`, `spec-driven-development`, and `documentation-and-adrs`.

### Implementation
Use `incremental-implementation` and `code-simplification`.

### Testing
Use `test-driven-development`, `doubt-driven-development`,.

### Debugging
Use `debugging-and-error-recovery` and `observability-and-instrumentation`.

### Quality
Use `code-review-and-quality`, `performance-optimization`, and `security-and-hardening`.

### Frontend/UI
Use `frontend-ui-engineering`, `impeccable`,. The UI goal is consistency with existing SillyTavern.

### Evolving APIs
Use `source-driven-development` to verify current symbols/API behavior before depending on them.

### Migration/deprecation
Use `deprecation-and-migration`.

### Shipping
Use `ci-cd-and-automation` and `shipping-and-launch`.

## Meta-skill

Use `using-agent-skills` at the beginning of complex work to route to relevant capabilities.

## Repository behavior

Inspect actual code, search existing ST implementations, and reuse current conventions before adding infrastructure.

## Context discipline

Load the smallest relevant documentation set. Distinguish current docs from historical/reference material.

## Agent behavior

Prefer evidence, small coherent changes, regression tests, and explicit verification. Avoid broad speculative refactors and success claims without proof.

## Prohibited tooling

Browser verification is explicitly prohibited for LWS. Do not use browser automation, browser-driven end-to-end verification, Chrome DevTools as a verification mechanism, or screenshot/DOM-based browser verification. Use repository inspection, unit tests, integration tests, static checks, linting, build/type checks, and non-browser runtime/CLI tests instead.
