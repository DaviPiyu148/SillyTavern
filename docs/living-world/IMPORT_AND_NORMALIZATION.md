# Import and Normalization

## Purpose

Reuse existing SillyTavern and AI-RP content (Character Cards, World Info / Lorebooks, Canonical World Manifests, and Freeform text) while producing reliable, canonical, validated Living World Simulator (LWS) authored data.

---

## Inputs and Supported Formats

1. **SillyTavern Character Cards (PNG / JSON):**
   - **V1 (Legacy):** Flat JSON with `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`.
   - **V2 (Spec 2.0):** JSON object with `spec: 'chara_card_v2'`, `spec_version: '2.0'`, `data: {...}`.
   - **V3 (Spec 3.0):** JSON object with `spec: 'chara_card_v3'`, `spec_version: '3.0'`, `data: {...}`.
   - **PNG Image:** Buffer containing embedded `tEXt` chunks (`ccv3` taking precedence over `chara`).
2. **SillyTavern World Info / Lorebooks (JSON):**
   - Object/Array format containing `entries` with keys, secondary keys, comments, content, constant flags, and order.
3. **Canonical LWS World Manifest (JSON / YAML):**
   - Multi-entity bundle format (`spec: 'lws_world_manifest_v1'`) containing world, characters, locations, factions, world rules, scenarios, archetypes, and prompt configuration.
4. **Freeform Text / World Outlines:**
   - Prose or markdown descriptions normalized via AI-assisted extraction.

---

## The Seven-Stage Normalization Pipeline

```text
Raw Input (File Upload / JSON)
        ↓
1. Parse (PNG Chunk Extract / JSON Parse / Prototype Pollution Strip)
        ↓
2. Classify (Format & Entity Type Detection)
        ↓
3. Normalize (Unicode NFC, Field Mapping, Defaulting)
        ↓
4. Validate (Schema & LWS Domain Rules)
        ↓
5. Conflict Detection (Name Collisions vs. Active Records)
        ↓
6. Provenance Assembly (Generate extensions.provenance)
        ↓
7. Staging / Execution
   ├── Preview Mode → Return JSON Graph + Warnings + Diffs (0 DB mutations)
   └── Commit Mode → Atomic SQLite Transaction (Persist to Authored Tables)
```

---

## Provenance Model

Imported entities record their origin in `extensions.provenance`:
- `source_type`: e.g. `sillytavern_card_v2`, `sillytavern_worldinfo`, `lws_world_manifest_v1`.
- `source_format`: `png`, `json`, or `yaml`.
- `source_name`: Original file name or identifier.
- `source_version`: Spec version of source card/manifest.
- `source_hash`: SHA-256 hash of original raw data.
- `imported_at`: ISO 8601 UTC timestamp.
- `normalizer_version`: Semantic version of the LWS normalizer.
- `field_mappings`: Key-value map of source field $\to$ LWS authored field.
- `unmapped_keys`: Array of source keys preserved in extensions without direct LWS mapping.
- `warnings`: Array of validation or classification warnings.

---

## Missing Data & Untrusted Content

1. **Missing Remains Missing:** If a source card does not provide a field (e.g. `personality` or `scenario_context`), it defaults to an empty string. The normalizer never hallucinates or populates fabricated data.
2. **Untrusted Model Output:** AI-assisted normalization outputs are treated as untrusted proposals. They must pass full JSON schema parsing, text length constraints, and LWS domain rules before they can be committed to the database.

---

## Conflict Detection & Reimport Policies

When an imported entity has the same name as an existing active record in the target World (`deleted_at IS NULL`), four deterministic resolution policies are available:

- **`REJECT` (Default):** Rejects the import with HTTP 409 Conflict and lists colliding entities.
- **`RENAME`:** Appends an incremental suffix (e.g. `Name (Import 2)`) and creates a new entity.
- **`REPLACE`:** Soft-deletes the existing active record (`deleted_at = isoNow()`) and creates a fresh entity. (In-flight simulations remain safe because runtime characters retain frozen snapshots).
- **`MERGE`:** Updates the existing active record in place with non-empty imported fields, merging tags and logging provenance history.

---

## Authored vs. Runtime Separation

```text
ST Character Card / Lorebook / Manifest
        ↓
[Normalization Pipeline]
        ↓
Authored Entities (lws_worlds, lws_characters, lws_locations, etc.)
        ↓
[Simulation Instantiation - Phase 3]
        ↓
SimulationCharacter / Runtime Entities (lws_simulations, lws_simulation_characters)
```

Import and authoring strictly manipulate **Authored** domain data. They **NEVER** instantiate or mutate runtime simulation state (`lws_simulations`, `lws_simulation_characters`, `lws_events`).

---

## Planning Reference

For the complete Phase 11 specification, acceptance criteria matrix, test strategy, and decision register, refer to [PHASE_11_PLAN.md](file:///D:/SillyTavern/docs/living-world/PHASE_11_PLAN.md).
