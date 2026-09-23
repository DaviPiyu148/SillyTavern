# LWS Agent Instructions

## Mission

Implement Living World Simulator (LWS) as a native subsystem of this SillyTavern fork. Extend SillyTavern; do not build a second application beside it.

## Read before working

- `docs/living-world/DOCUMENTATION_INDEX.md` — choose the relevant document.
- `docs/living-world/PROJECT_STATE.md` — distinguish implemented from designed work.
- `docs/living-world/ARCHITECTURE.md` — system boundaries.
- `docs/living-world/DOMAIN_RULES.md` — non-negotiable invariants.
- `docs/living-world/SILLYTAVERN_INTEGRATION.md` — host integration rules.
- `docs/living-world/DEVELOPMENT_WORKFLOW.md` — implementation workflow.
- `docs/living-world/TESTING.md` — proof expectations.
- `docs/living-world/DEBUGGING.md` — root-cause debugging method.

Do not load every document for every task. Follow the documentation map and retrieve only the context required for the current phase/change.

## Non-negotiable rules

1. LWS is a native subsystem, not a plugin and not a separate server/application.
2. Reuse SillyTavern infrastructure before creating replacements.
3. Do not put authoritative simulation state in chat history, `chat_metadata`, macros, or prompt text.
4. The LLM must never directly mutate authoritative state.
5. Authored definitions and simulation runtime state remain separate.
6. Knowledge is filtered by what a character could actually know.
7. Camera/observation changes what is presented, not what exists.
8. Travel consumes fictional time.
9. Persistent character development must have causal evidence.
10. User system prompts remain configurable where supported, but prompts cannot bypass application-enforced simulation, validation, persistence, or security boundaries.
11. Do not create directories or abstractions merely because a conceptual architecture diagram contains a box for them.
12. Do not claim a feature is implemented or verified without repository/test evidence.
13. Development is phase-based. Use `docs/living-world/PHASE_DEVELOPMENT_PLAN.md` as the fixed phase roadmap.
14. A whole phase is the delivery unit. Do not replace phases with independently delivered subtasks, slices, or mini-phases.
15. Do not begin the next planned phase until the current phase is complete or explicitly blocked by an accepted decision.
13. Browser verification is prohibited. Do not use browser automation, DevTools-based verification, or browser-driven tests.

## Implementation discipline

Understand → inspect → reuse → make the smallest coherent change → test → verify → document → commit.

Use skills deliberately. See `docs/living-world/TOOLING_AND_SKILLS.md`.

## Documentation discipline

Update documentation when a change alters architecture, authoritative domain rules, API contracts, persistence/replay semantics, testing/debugging procedure, current implementation status, or an accepted design decision.

Do not turn this file into a procedure manual. Put detailed procedures in the specialized documents.
