# ADR-019: Import, Normalization, Provenance, and Authored Creation Workflow

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 11)

## Context

The Living World Simulator (LWS) maintains a strict architectural boundary between **authored world definitions** and **active simulation runtime state** (ADR-006, ADR-011).

To enable authoring of rich simulation worlds from external content, LWS requires a comprehensive, deterministic import and normalization pipeline capable of ingesting:
1. **SillyTavern Character Cards:** Spec V1, Spec V2, Spec V3 (JSON and PNG `tEXt` chunks with `ccv3` over `chara` precedence), mapping all 22 standard fields into canonical authored columns and vendor extensions.
2. **World Info / Lorebooks:** Evaluating lore entries across a 5D structural scoring model ($S_{\text{rule}}, S_{\text{loc}}, S_{\text{fac}}, S_{\text{arch}}, S_{\text{char}}$) with strict ambiguity detection ($\Delta < 0.25$) and conservative flavor fallback ("Lore is not physical reality").
3. **Canonical LWS World Manifests (`lws_world_manifest_v1`):** Complete interchange format in JSON and secure YAML (Billion Laughs / prototype-pollution protected) with symmetric round-trip export/import parity.
4. **Freeform Outlines & AI Normalization:** Structured section and typed heading extraction with AI-assisted extraction strictly governed by a negative no-invention contract.
5. **Conflict Resolution & Active Collision Detection:** Formal collision detection across all 10 authored tables with 4 explicit policies: `REJECT`, `RENAME`, `REPLACE`, and non-destructive explicit field `MERGE`.
6. **Mandatory Preview Token Binding & TOCTOU Defense:** HMAC-SHA256 preview tokens binding target world, candidate payload hash, and 10-table canonical `preview_state_hash`, verified in-transaction with SQLite `EXCLUSIVE` locking.
7. **End-to-End Provenance Preservation:** Tracking source file hashes, raw payload hashes, extracted chunk hashes, field renamings, and unmapped vendor fields inside `extensions.provenance` with zero schema changes (`PRAGMA user_version = 9`).

---

## Decision

### 1. Ingestion Pipeline & Normalization Engines

- **Character Card Normalizer (`src/living-world/import/card-importer.js`):**
  - Parses JSON strings, plain objects, and binary PNG buffers.
  - Extracts PNG metadata chunks with Spec V3 (`ccv3`) precedence over Spec V2/V1 (`chara`).
  - Maps 22 standard fields into `lws_characters` columns (`name`, `description`, `personality`, `scenario_context`, `mes_example`, `author_notes`, `system_prompt_override`, `source_version`, `tags`) and `extensions` (`first_mes`, `alternate_greetings`, `post_history_instructions`, `creator`, `nickname`, `assets`, `creator_notes_multilingual`, `sources`, `group_only_greetings`, `unmapped_fields`).
  - Derives `first_mes` fallback if primary `first_mes` is empty.
- **Lorebook / World Info Normalizer (`src/living-world/import/worldinfo-importer.js`):**
  - Evaluates entries across 5 structural dimensions.
  - High-confidence promotion requires $\max(S_i) \ge 0.80$ and margin $\ge 0.20$.
  - Ambiguous entries ($0.50 \le \max < 0.80$ or margin $< 0.25$) are flagged in preview and fall back to `lore_entries` in `extensions.lorebook` rather than mutating authoritative world rules.
- **Canonical World Manifest Exchange (`src/living-world/import/manifest-importer.js`):**
  - Canonical format `lws_world_manifest_v1` supported in JSON and YAML (`yaml` v2.8.3).
  - Enforces schema validation, cardinality limits, and location tree acyclicity ($\le 10$ levels deep).
  - Exports full round-trip world manifests (`exportWorldManifest`) and validates relational topology parity (`compareManifestParity`).
- **Freeform Importer & AI Normalizer (`src/living-world/import/freeform-importer.js`, `src/living-world/import/ai-normalizer.js`):**
  - Chunks unstructured markdown outlines by sections and typed headings (`## Location: ...`, `## Faction: ...`).
  - Formats AI prompts with a negative no-invention contract ("Extract only explicitly stated facts. Do not invent unmentioned locations, factions, or rules").
  - Quarantines AI output as untrusted candidate proposals until schema and domain validation pass.

### 2. Active Collision Detection & Conflict Policies

Implemented in `src/living-world/import/conflicts.js`:
- **Collision Detector:** Evaluates incoming candidate entities against active database records (`deleted_at IS NULL`) for active name collisions, archetype key collisions, UUID collisions, and join table relationship collisions.
- **Policies:**
  - `REJECT`: Fails import atomically with HTTP 409 Conflict; 0 database mutations.
  - `RENAME`: Disambiguates entity name by appending `(Import 2)`, `(Import 3)`, etc., and allocates fresh UUIDs.
  - `REPLACE`: Soft-deletes existing conflicting records (`deleted_at = isoNow()`) and inserts fresh records.
  - `MERGE`: Non-destructive explicit field merge (preserves existing name; updates non-empty descriptions; union-merges tags; deep merges extensions; appends to import history).

### 3. HMAC-SHA256 Preview Token & TOCTOU Revalidation

Implemented in `src/living-world/import/common.js` and `src/living-world/import/authoring.js`:
- **Preview Phase (`previewImport`):** Normalizes payload into candidate graph, computes `candidate_hash` via RFC 8785 canonical JSON, computes 10-table `preview_state_hash`, and issues an HMAC-SHA256 preview token with a 15-minute TTL.
- **Commit Phase (`commitImport`):** Enforces in-transaction verification under SQLite `EXCLUSIVE` locking:
  1. Re-computes current 10-table `preview_state_hash`.
  2. Verifies HMAC signature, TTL expiration, candidate hash equality, and state hash match.
  3. Re-validates entity collisions under the selected conflict policy.
  4. Inserts/updates records across all 10 authored tables atomically.

### 4. Authored vs. Runtime Isolation

Import operations write strictly to the 10 authored tables. In-flight simulations (`lws_simulations`) and active simulation characters (`lws_simulation_characters`) remain completely unperturbed:
- Simulation characters continue reading their immutable `authored_snapshot` frozen at instantiation.
- Soft-deleted locations and factions maintain SQLite integer referential integrity.
- Simulation replay remains event-driven and zero-SQL.

### 5. HTTP REST Endpoints

Mounted in `src/endpoints/living-world.js`:
1. `POST /api/living-world/import/character/preview`
2. `POST /api/living-world/worlds/:worldLwsId/import/character`
3. `POST /api/living-world/import/worldinfo/preview`
4. `POST /api/living-world/worlds/:worldLwsId/import/worldinfo`
5. `POST /api/living-world/import/freeform/preview`
6. `POST /api/living-world/worlds/:worldLwsId/import/freeform`
7. `POST /api/living-world/import/manifest/preview`
8. `POST /api/living-world/import/manifest/commit`
9. `GET /api/living-world/worlds/:worldLwsId/export/manifest`

---

## Consequences

- Authors can import cards, lorebooks, manifests, and freeform text safely with immediate advisory previews and explicit conflict control.
- Full provenance and vendor extensions are preserved for round-trip fidelity without modifying the underlying database schema (`PRAGMA user_version = 9`).
- Concurrent edits to authored world definitions are protected against race conditions and stale previews via cryptographic TOCTOU token verification.
- Active running simulations are completely isolated from authored modifications.
