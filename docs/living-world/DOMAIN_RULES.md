# LWS Domain Rules

These rules are invariants. Changes that intentionally alter them require an explicit architectural decision.

## Authority

1. The Simulation Engine/database define authoritative reality.
2. The LLM cannot directly mutate authoritative state.
3. Consequential state changes pass through parsing/schema validation, domain validation, event/state transition, and transactional persistence.
4. Narrative prose is presentation, not state.

## Authored vs runtime

5. Authored Character/World definitions are reusable and stable.
6. `SimulationCharacter` and other runtime state are simulation-scoped and mutable.
7. Runtime mutation in one simulation must not change authored definitions or another simulation.

## Truth, perception, knowledge, belief, memory

8. World truth is not the same as what a character knows.
9. Perception is based on actual location, distance, visibility, barriers, lighting, stealth, attention, and event type where modeled.
10. Knowledge is acquired through valid channels such as perception, communication, records, evidence, backstory, inference, or authorized Director injection.
11. Beliefs and suspicions may be wrong.
12. Memory is subjective and persistent; it is not a substitute for world truth.
13. Historical perception must be preserved with executed events where replay depends on it.

## Characters

14. Characters may misunderstand, procrastinate, lie, deceive, self-deceive, act emotionally, act irrationally, regress, or hold conflicting beliefs.
15. Persistent personality/state changes must have causal evidence.
16. Character growth can accelerate, reverse, conflict, or stagnate.
17. Relationships are directional. Sarah→John and John→Sarah are separate states.
18. Relationships should retain causal evidence rather than acting as unexplained scalar values.
19. Factions are social systems, not hive minds.

## Time and world life

20. Fictional time is separate from wall-clock time.
21. Default simulation progression is on-demand/event-driven.
22. Deterministic world-life should not require unnecessary LLM calls.
23. Routines are expectations, not absolute commands.
24. Travel consumes fictional time.
25. Time advancement must preserve chronological monotonicity and deterministic ordering.
26. Replay must reconstruct supported runtime state from committed event history without invoking the LLM.

## Observation

27. The Observer is external to the fiction.
28. Characters do not know they are being observed unless the world itself explicitly contains an in-world reason.
29. `FOLLOW_CHARACTER` changes the camera/observation focus, not the simulation scope.
30. The Observer may receive privileged inspection views when explicitly requested; that does not grant the same information to characters.

## Population and emergence

31. Ambient people and vehicles may be generated to make locations feel lived-in.
32. Emergent entities may be promoted to persistent Supporting/Core entities when repeated relevance warrants it.
33. Ambient population should not become a second full-city simulation.

## Prompt configuration

34. User system prompts are supported as first-class configuration.
35. Prompt text cannot directly bypass application-enforced simulation authority, state validation, persistence, or security.
36. Prompt ordering is not a security boundary.

## Security

37. Imported content, model output, and prompt content are untrusted inputs.
38. The LLM does not receive unrestricted hidden state when that would violate character knowledge boundaries.
39. State-changing operations fail closed on validation errors.
