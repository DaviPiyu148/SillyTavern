# ADR-020: Native SillyTavern User Workflow and UI Architecture

## Status

ACCEPTED (Implemented, verified, and accepted in Phase 12)

## Context

The Living World Simulator (LWS) requires a user interface and native operational workflow within SillyTavern. Prior to Phase 12, all simulation capabilities (Phases 1–11) operated through REST APIs, SQLite triggers, and domain services without a user-facing visual workspace or SillyTavern integration surfaces.

To deliver Phase 12 as a native subsystem of SillyTavern without violating core invariants:
1. **Native Subsystem Discipline (`AGENTS.md` Rule 1 & 2):** LWS must look, feel, and behave as native SillyTavern rather than a second application, standalone React bundle, or foreign framework.
2. **Authority Boundary (`AGENTS.md` Rule 3 & 4):** Authoritative simulation state resides strictly in SQLite (`data/living-world/lws.db`). The frontend UI maintains strictly transient view models and local selection state. All state mutations flow through server-enforced event and authority pipelines; the LLM and user never mutate state directly.
3. **Session Hydration & Client-Local State:** `accountStorage` is utilized solely as client-local convenience state for the last selected simulation on that specific browser. Initial session discovery on a new device or cleared browser occurs via backend world and simulation selection endpoints.
4. **Epistemic Discipline & Multi-Character Autonomy (The "Charlotte & Tom" Rule):** Following Character A (Dave) does not freeze off-camera Character B (Charlotte). Temporal progression advances all characters independently in SQLite. The UI must maintain strict perspective filtering and zero sensory leakage.
5. **Non-Browser Automated Verification Discipline:** In strict accordance with the AGENTS browser-verification prohibition, verification is executed entirely without browser automation, Playwright, DevTools, or screenshots, utilizing Node-based Jest unit and integration suites, static CSS/template string analyzers, and live Express API workflow integration tests.
6. **Zero Database Migrations:** Phase 12 introduces zero SQL schema migrations (`PRAGMA user_version = 9`).

---

## Decision

### 1. Native SillyTavern Integration & Scoped CSS Styling
- **Stylesheet (`public/css/living-world.css`):**
  - All styles are strictly scoped under `#lws-workspace`, `#lws-*`, and `.lws-*`.
  - Zero CSS leakage into outer SillyTavern elements (`body`, `#chat`, `.drawer`).
  - Utilizes SillyTavern theme custom properties (`var(--SmartThemeBodyColor)`, `var(--SmartThemeBorderColor)`, `var(--SmartThemeChatTintColor)`, `var(--topBarHeight)`).
  - Linked in `public/index.html` `<head>` without modifying core styles.
- **Top-Bar Integration & Workspace Mounting:**
  - Bootstrap stub in `public/scripts/living-world/index.js` mounts `#lws-topbar-button` with FontAwesome 6 icon (`fa-earth-americas`).
  - Toggling button shows/hides `#lws-workspace`.
  - Mounted via `<script type="module" src="scripts/living-world/index.js"></script>` in `public/index.html`.

### 2. Frontend Subsystem Architecture (`public/scripts/living-world/`)
1. **`index.js` (Subsystem Coordinator):**
   - Bootstraps LWS on host readiness.
   - Instantiates `LwsUiShell`, component views, registers slash commands, and executes the 5-stage Session Hydration Sequence.
2. **`state.js` (Reactive State Store):**
   - Lightweight event-driven reactive state store with `on()`, `off()`, `emit()`, `getState()`, `setState()`.
   - Synchronizes `lws_last_sim_id` with `accountStorage` as client-local convenience cache.
   - Handles `resetOn404()` gracefully on missing/deleted simulations.
3. **`api.js` (Typed REST API Client):**
   - Typed client wrapping all required `/api/living-world/*` routes.
   - Attaches SillyTavern headers (`getRequestHeaders`) and handles JSON/multipart serialization.
   - Normalizes parameter aliases (`advance_seconds` $\to$ `duration_seconds`, `target_character_lws_id` $\to$ `target_character_id`).
4. **`templates.js` (Semantic Templates & Sanitization):**
   - HTML string templates using semantic landmarks (`<main>`, `<header>`, `<nav>`, `<section>`, `<article>`).
   - Strict XSS sanitization via `escapeHtml()`.
   - Accessible ARIA attributes (`role="tab"`, `role="tabpanel"`, `role="progressbar"`, `aria-selected`, `aria-valuenow`).
5. **`slash-commands.js` (Native Slash Commands):**
   - Registers `/lws`, `/lws-time`, `/lws-time-set`, `/lws-camera`, `/lws-inspect`, `/lws-director`, `/lws-generate` via `SlashCommandParser`.
   - Parses duration strings (`1h`, `30m`, `1d`, `3600s`).
   - Dispatches to dedicated domain REST endpoints.
6. **Component Views:**
   - `ui-shell.js`: Workspace layout, top-bar badges (World, Sim, Fictional Clock, Camera mode), tab navigation switcher.
   - `ui-world-browser.js`: World CRUD, scenario management, simulation launcher modal.
   - `ui-authored-roster.js`: Authored characters, locations, factions, world rules, ambient archetypes, prompt configs.
   - `ui-import-wizard.js`: 2-stage import modal for Character Cards, Lorebooks, Freeform outlines, and Canonical Manifests with preview token binding.
   - `ui-narrative-view.js`: Chronological turn stream, dialogue bubbles, user prompt submission (`/generate`).
   - `ui-mind-inspector.js`: Epistemic mind inspector: needs progress bars, active goals, subjective beliefs, perspective filtering.
   - `ui-director-console.js`: Time advance, camera switching, dedicated social/environment interventions, entity promotions.

### 3. Session Hydration Sequence & Authority
1. Read `accountStorage.getItem('lws_last_sim_id')`.
2. If present, dispatch `GET /api/living-world/simulations/:simLwsId` to validate.
3. On HTTP 200, fetch parallel session streams (`camera`, `characters`, `turns`).
4. Hydrate inspector perspective: `follow_character` $\to$ `GET .../perspective` + `GET .../cognition`; `god_view` $\to$ `GET .../observer/perspective`.
5. On HTTP 404 or empty key, clear `accountStorage` and render World/Simulation selection view.

### 4. Epistemic Isolation & Autonomy Verification
- **AC-3a (Off-Camera Progression):** Advancing time via `POST /simulations/:id/time-advance` while following Dave causes off-camera Charlotte to progress routines and travel in SQLite independently.
- **AC-3b (Zero Sensory Leakage):** Querying Dave's subjective perspective (`GET .../characters/:id/perspective`) reveals zero unperceived sensory info (Charlotte excluded from `co_located_characters`), knowledge, memories, or beliefs from Charlotte's distant movements.
- **AC-3c (Camera Switch & Rehydration):** Switching camera to Charlotte (`POST /simulations/:id/camera`) reveals her authoritative location (`current_location`) and decayed needs. Camera switching itself never synthesizes memories or mutates state.
- **AC-4 (Mind Inspector vs Observer Ground Truth):** In `follow_character` mode, only the focused character's subjective state is displayed. In Observer perspective (`GET .../observer/perspective`), privileged global ground truth across all locations and characters is provided with read-only semantics.

---

## Consequences

- Complete LWS user workflow is fully functional within native SillyTavern UI.
- Zero external frontend frameworks, React, or build steps required.
- Zero database migrations (`PRAGMA user_version = 9`).
- 100% test coverage with 7 dedicated Phase 12 test suites (59/59 tests passing).
- Zero regressions across existing 78 LWS suites (cumulative 85 suites, 596/596 tests passing).
- Full repository test pass: 104/104 suites, 1007/1007 tests passing.
