# LWS Planning

Planning exists to reduce rework, not to produce large speculative documents.

## Required content for non-trivial work

1. Goal.
2. Current behavior/evidence.
3. Desired behavior.
4. Relevant invariants.
5. Existing ST implementation to reuse.
6. Exact modules/files likely affected.
7. Data/state boundary.
8. API/event contract changes.
9. Test/verification strategy.
10. Risks and containment/rollback path.
11. Implementation order.

## Planning discipline

Inspect the repository before inventing architecture. Search current ST capabilities. Read only the relevant docs. Identify the smallest coherent change.

## Skills

Use relevant skills including planning/task breakdown, spec-driven development, source-driven development, context engineering, code simplification, incremental implementation, TDD, debugging, code review, security/hardening, frontend UI engineering, Impeccable for UI work. See `TOOLING_AND_SKILLS.md`.

## Acceptance criteria

Write behavioral, observable criteria.

Bad: “Refactor simulation layer.”

Good: “After advancing one fictional hour, Dave's persisted activity and simulation time remain correct after restart.”

## Stop condition

The plan is sufficient when boundaries, affected files, dependencies, and proof are clear. Do not create extra planning artifacts just to appear thorough.


## Phase-based development

The predetermined phase sequence is defined in `PHASE_DEVELOPMENT_PLAN.md`.

Planning is performed for the **active phase as a whole**.

Do not plan a phase as a collection of separately delivered slices. The plan should describe:
- phase goal;
- complete phase scope;
- affected architecture/contracts;
- dependencies;
- phase-level acceptance criteria;
- phase-level verification;
- risks/blockers.

Internal implementation organization may be necessary, but it does not change the phase boundary or create independently shippable phase fragments.

A phase is not complete until its full acceptance criteria are met.

When a requirement cannot be completed because of a dependency, mark the phase `BLOCKED` and document the blocking decision/dependency. Do not silently move the unfinished requirement into a later phase.
