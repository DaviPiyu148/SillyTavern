# Import and Normalization

## Purpose

Reuse existing SillyTavern/AI-RP content while producing reliable canonical LWS data.

## Inputs

- ST Character Cards;
- World Info/lorebooks;
- world descriptions;
- scenarios;
- freeform text;
- AI-generated drafts;
- supported metadata/assets.

## Pipeline

```text
raw source
→ parser
→ classifier
→ normalizer
→ schema validation
→ duplicate/conflict detection
→ review for ambiguity
→ canonical LWS data
→ persistence
```

## Provenance

Preserve original source, source type/identity where available, normalized field provenance where practical, explicit vs inferred information, and uncertainty/conflicts.

## Missing data

Missing remains missing. Do not invent detail merely to satisfy a richer schema.

## AI-assisted normalization

AI may help extract/classify/normalize, but its output is untrusted until validated. Ambiguity that materially changes behavior should be reviewed rather than silently chosen.

## Existing character import

```text
ST Character Card
→ normalization
→ authored Character
→ SimulationCharacter when instantiated
```

## World Info

Differentiate authoritative world rules from lore, flavor, style, and unsupported metadata. Do not automatically turn arbitrary lore text into physical reality.

## Conflict detection

Example:

```text
Source A: Charlotte lives in Dallas.
Source B: Charlotte lives in Austin.
```

Record the conflict and provenance; do not silently choose.
