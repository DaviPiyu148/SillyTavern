# LWS Debugging

## Root-cause method

```text
Reproduce
→ Observe
→ Isolate
→ Identify root cause
→ Add regression test
→ Fix root cause
→ Reproduce original failure
→ Test related behavior
→ Verify
```

## Reproduce

Capture exact input/command, simulation state, fictional time, camera/character, model/generation settings if relevant, expected result, and actual result. Control seed/time/fixtures when possible.

## Observe

Collect logs, event records, persisted state, model proposal, validation result, API request/response, browser console/network output, and prompt/generation trace as relevant.

Do not guess from symptoms alone.

## Isolate

Find the first boundary where the invariant breaks:

```text
UI
→ API
→ application service
→ simulation/domain
→ event staging
→ validation
→ persistence
→ replay
→ prompt/context
→ ST generation
```

## Identify root cause

State the mechanism precisely. Do not use “LLM issue” as a diagnosis unless model output is actually the first failing boundary.

## Regression test and fix

Make the original failure reproducible in a focused test, then fix the responsible boundary rather than only the visible symptom.

## Verify

Verify the original failure, adjacent valid behavior, relevant regression suite, and integration path when affected.

## LLM debugging

Inspect the full chain:

```text
authoritative state
→ selected context
→ knowledge filtering
→ prompt assembly
→ ST formatting
→ model output
→ parser
→ validation
→ committed events
→ narrative
```

Do not immediately modify prompts before checking state/context/filtering/parsing/validation.

## Replay debugging

Find the first divergent event, compare reducer input/output, inspect deterministic ordering and projection assumptions, fix the earliest incorrect transition, and rerun replay parity.
