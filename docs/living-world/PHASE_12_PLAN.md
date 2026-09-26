# Phase 12 Planning Specification: Native SillyTavern User Workflow and UI

## Document Status: PLANNING — FINAL PRE-AUTHORIZATION FREEZE SPECIFICATION

**Target Subsystem:** Living World Simulator (LWS)  
**Phase:** Phase 12 — Native SillyTavern User Workflow and UI  
**Target Repository:** `DaviPiyu148/SillyTavern`, Branch `release`  
**Prerequisite Baseline:** Phase 11 (Import, Normalization, and Authoring Workflow) — IMPLEMENTED, VERIFIED, ACCEPTED (Commit `40816c357`)  
**Database Schema Version:** `PRAGMA user_version = 9` (Zero SQL migrations in Phase 12; physical schema remains unmodified)  
**Prerequisite Test Baseline:** 78/78 LWS test suites (537/537 tests passing), 97/97 full repo test suites (948/948 tests passing)  
**Phase 12 Implementation Status:** PENDING AUTHORIZATION  
**Phase 12 Verification Status:** PENDING AUTHORIZATION (0 Phase 12 test suites executed prior to authorization; 7 planned suites define the post-authorization verification gate)  
**Backend Route Evidence:** 123 route declarations source-audited directly from `src/endpoints/living-world.js` (Prerequisite endpoint functionality verified via 78 baseline test suites; Phase 12 UI client integration to be verified across 7 planned Phase 12 test suites)  

---

## 1. Executive Summary & Objective

Phase 12 delivers the native user-facing workflow and user interface for the Living World Simulator within SillyTavern. It exposes the complete multi-phase simulation engine (Phases 1–11) through SillyTavern's native UI/UX language, drawers, popups, theme variables, slash commands, and responsive conventions.

### Core Architectural Principles:
1. **Native SillyTavern Look & Feel:** The interface looks, feels, and behaves as a native core capability of SillyTavern rather than a separate application, standalone React bundle, or foreign framework.
2. **Strict Authority Boundary:** Authoritative simulation state resides strictly in SQLite (`data/living-world/lws.db`). The frontend UI maintains strictly transient view models and local selection state. All state mutations flow through server-enforced event and authority pipelines.
3. **Session Hydration & Client-Local State:** `accountStorage` is utilized solely as client-local convenience state for the last selected simulation on that specific browser. Initial session discovery on a new device or cleared browser occurs via backend world and simulation selection endpoints.
4. **Epistemic Discipline & Authorization Boundary:**
   - *Host Authentication & Operator Scope:* SillyTavern operates under a single-operator (or host-authenticated) application security model where any authenticated client session possesses operator/director capabilities. There is no distinct server-side role-based access control (RBAC) or separate API key tier distinguishing an "Observer client" from a "Character client" over HTTP.
   - *Server-Side Boundary:* The authoritative boundary is enforced at the endpoint and pipeline layer:
     - `GET /api/living-world/simulations/:simLwsId/observer/perspective` (Observer Tier) evaluates and returns unredacted global ground truth across all simulation entities (locations, characters, camera) with read-only semantics.
     - `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/perspective` (Character-Subjective Tier) runs `buildSubjectivePerspective` to isolate knowledge, memories, beliefs, and nearby co-located characters, strictly filtering out unperceived world state.
   - *Presentation Layer:* Frontend control visibility (e.g., toggling God View vs Mind Inspector) is purely presentation layer logic, not a security boundary.
5. **Multi-Character Autonomy (The "Charlotte & Tom" Rule):** Following one character does not suspend off-camera characters or background world processes. Discrete timeline progression advances all characters independently in SQLite.
6. **Non-Browser Automated Verification Discipline:** In strict accordance with the AGENTS browser-verification prohibition, verification is executed entirely without browser automation, Playwright, DevTools, or screenshots, utilizing Node-based Jest unit and integration suites, static CSS/template string analyzers, and live Express API workflow integration tests.

---

## 2. Architecture & Module Structure

Frontend files are housed strictly within the native SillyTavern namespace under `public/scripts/living-world/` and `public/css/living-world.css`.

- **Existing Host Integration Scaffolding:** `public/index.html` (mount line 8219) and bootstrap stub `public/scripts/living-world/index.js` exist in the repository.
- **Planned Phase 12 Modules (Frozen by Specification):** 10 child modules and 1 CSS stylesheet specified for implementation upon authorization:

```text
public/
├── css/
│   └── living-world.css                      # Scoped LWS styling (#lws-workspace, .lws-*) using ST theme variables
└── scripts/
    └── living-world/
        ├── index.js                          # Bootstrap, lifecycle hooks, and top-bar/drawer mounting
        ├── state.js                          # Reactive UI state store, active selection & accountStorage sync
        ├── api.js                            # Typed REST API client for required /api/living-world/* endpoints
        ├── templates.js                      # HTML component templates & strict XSS escaping (escapeHtml)
        ├── slash-commands.js                 # SillyTavern SlashCommandParser registrations & callbacks
        ├── ui-shell.js                       # Workspace container, top-bar navigation, mode toggle, responsive layout
        ├── ui-world-browser.js               # World listing, creation, editing, deletion & scenario launcher
        ├── ui-authored-roster.js             # Authored characters, locations, factions, world rules & archetypes
        ├── ui-import-wizard.js               # Phase 11 import wizard: Card, Lorebook, Freeform, Manifest preview/commit
        ├── ui-narrative-view.js              # Narrative turn stream, user input composer, dialogue bubbles, turn generation
        ├── ui-mind-inspector.js              # Epistemic mind inspector: needs, goals, values, emotions, beliefs, relationships
        └── ui-director-console.js            # Time advance, dedicated social/env interventions, promotions, camera switcher
```

### Module Responsibilities & Defined Operations:

| Module | Responsibility & Defined Operations | Dependencies |
|---|---|---|
| **`index.js`** | Subsystem bootstrap on SillyTavern startup (`APP_READY`), top-bar icon injection, drawer registration, session hydration bootstrap. | `ui-shell.js`, `slash-commands.js`, `state.js`, `api.js` |
| **`state.js`** | Manages transient UI session state (`world_lws_id`, `simulation_lws_id`, `camera_mode`, `selected_char_lws_id`, `is_generating`). Synchronizes last active simulation ID with `accountStorage`. | `accountStorage` (ST utility) |
| **`api.js`** | Typed client wrapper for required LWS REST endpoints handling request serialization, ST headers (`getRequestHeaders`), error mapping, and preview tokens. | Native `fetch`, ST `getRequestHeaders` |
| **`templates.js`** | Semantic, accessible HTML string templates with mandatory sanitization via `escapeHtml()`. | `public/scripts/utils.js` (`escapeHtml`) |
| **`slash-commands.js`** | Registers `/lws`, `/lws-time`, `/lws-time-set`, `/lws-camera`, `/lws-inspect`, `/lws-director`, `/lws-generate` with SillyTavern parser. | `SlashCommandParser` (ST core), `state.js`, `api.js` |
| **`ui-shell.js`** | Mounts `#lws-workspace`, renders top status bar (World, Sim, Fictional Clock, Camera badge), coordinates drawer toggle and mobile responsiveness. | `state.js`, `templates.js`, `popup.js` |
| **`ui-world-browser.js`** | Lists available worlds, world CRUD forms (Create, Read, Update, Delete), scenario management (Create, Read, Update, Delete), and simulation instantiation modal. | `api.js`, `state.js`, `templates.js`, `popup.js` |
| **`ui-authored-roster.js`** | Full CRUD for characters, hierarchical locations, factions, world rules, and ambient archetypes; membership List/Add/Remove for faction members and scenario rosters; Get/Update for prompt configs. | `api.js`, `state.js`, `templates.js`, `popup.js` |
| **`ui-import-wizard.js`** | Phase 11 import modal for Character Cards, Lorebooks, Freeform text, and Canonical Manifests with 2-stage preview, conflict policy review, and HMAC commit. | `api.js`, `state.js`, `templates.js`, `popup.js` |
| **`ui-narrative-view.js`** | Chronological turn stream, dialogue rendering, user prompt submission (`/generate`), and turn savepoint feedback. | `api.js`, `state.js`, `templates.js`, `message-formatter.js` |
| **`ui-mind-inspector.js`** | Renders character cognitive needs, acute goals, moral values, emotion intensity, subjective memories/beliefs, and outgoing relationship ratings. | `api.js`, `state.js`, `templates.js` |
| **`ui-director-console.js`** | Time advancement controls (`POST /time-advance`), camera switching (`POST /camera`), dedicated social/environment interventions, and character tier promotions (`POST /promotions`). | `api.js`, `state.js`, `templates.js`, `popup.js` |

---

## 3. Existing SillyTavern Infrastructure Reuse Matrix

In strict adherence to `AGENTS.md` Rule 2, Phase 12 reuses existing SillyTavern infrastructure rather than introducing custom frameworks:

| SillyTavern Subsystem | Host Source File | LWS Reuse Mechanism |
|---|---|---|
| **Dialogs & Popups** | [`public/scripts/popup.js`](file:///D:/SillyTavern/public/scripts/popup.js) | Uses `Popup`, `callGenericPopup`, `POPUP_TYPE.CONFIRM`, `POPUP_TYPE.FORM`, `POPUP_TYPE.TEXT` for all creation forms, import preview reviews, and deletion confirmations. |
| **Notifications** | `public/css/toastr.min.css` / global `toastr` | Uses `toastr.success()`, `toastr.error()`, `toastr.warning()`, `toastr.info()` for non-blocking feedback. |
| **Icons** | FontAwesome 6 (`css/fontawesome.min.css`) | Uses native FontAwesome icons (`fa-earth-americas`, `fa-video`, `fa-clock`, `fa-user`, `fa-brain`, `fa-sliders`, `fa-wand-magic-sparkles`). |
| **Theme & Styling** | [`public/style.css`](file:///D:/SillyTavern/public/style.css), [`public/css/st-tailwind.css`](file:///D:/SillyTavern/public/css/st-tailwind.css) | Styles use ST CSS custom properties (`var(--SmartThemeBodyColor)`, `var(--SmartThemeBorderColor)`, `var(--SmartThemeChatTintColor)`, `var(--shadowColor)`). |
| **Slash Commands** | [`public/scripts/slash-commands.js`](file:///D:/SillyTavern/public/scripts/slash-commands.js) | Registers commands via `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))`. |
| **Markdown Prose** | [`public/scripts/message-formatter.js`](file:///D:/SillyTavern/public/scripts/message-formatter.js) | Formats narrative prose and dialogue bubbles through SillyTavern's message formatting pipeline. |
| **Client Session Storage** | [`public/scripts/util/AccountStorage.js`](file:///D:/SillyTavern/public/scripts/util/AccountStorage.js) | Uses `accountStorage.getItem()` / `setItem()` for client-local UI preferences (`lws_last_sim_id`, `lws_drawer_state`). |
| **Event Bus** | [`public/scripts/events.js`](file:///D:/SillyTavern/public/scripts/events.js) | Subscribes to host events (`APP_READY`, `CHAT_CHANGED`). |
| **Sanitization** | [`public/scripts/utils.js`](file:///D:/SillyTavern/public/scripts/utils.js) | Uses `escapeHtml()` for all user-authored strings before DOM injection. |

---

## 4. Authoritative REST API to UI Operation Contract Matrix

All authoritative domain state mutations and backend-backed simulation operations map strictly to existing canonical REST routes in [`src/endpoints/living-world.js`](file:///D:/SillyTavern/src/endpoints/living-world.js). Client-local UI actions (such as drawer toggling, active tab selection, form field editing, and `accountStorage` convenience caching) manage local presentation state and do not invoke backend domain mutations:

| Subsystem | UI Operation | Canonical Route in `src/endpoints/living-world.js` | HTTP Verb & Payload Contract |
|---|---|---|---|
| **World Management** | List all worlds | `GET /api/living-world/worlds` | Returns `worlds: [...]` |
| | Create new world | `POST /api/living-world/worlds` | `{ name, description, tags, style_notes, tone_notes, extensions }` |
| | Get world details | `GET /api/living-world/worlds/:worldLwsId` | Returns `world: {...}` |
| | Update world | `PATCH /api/living-world/worlds/:worldLwsId` | `{ name?, description?, tags?, style_notes?, tone_notes? }` |
| | Delete world (soft) | `DELETE /api/living-world/worlds/:worldLwsId` | HTTP 204 No Content |
| **Authored Roster** | List characters | `GET /api/living-world/worlds/:worldLwsId/characters` | Returns `characters: [...]` |
| | Create character | `POST /api/living-world/worlds/:worldLwsId/characters` | `{ name, description, personality, scenario_context, ... }` |
| | Update character | `PATCH /api/living-world/worlds/:worldLwsId/characters/:charLwsId` | `{ name?, description?, personality?, ... }` |
| | Delete character | `DELETE /api/living-world/worlds/:worldLwsId/characters/:charLwsId` | HTTP 204 No Content |
| | List locations | `GET /api/living-world/worlds/:worldLwsId/locations` | Returns `locations: [...]` |
| | Create location | `POST /api/living-world/worlds/:worldLwsId/locations` | `{ name, description, parent_location_id, ... }` |
| | Update location | `PATCH /api/living-world/worlds/:worldLwsId/locations/:locLwsId` | `{ name?, description?, parent_location_id?, ... }` |
| | Delete location | `DELETE /api/living-world/worlds/:worldLwsId/locations/:locLwsId` | HTTP 204 No Content |
| | List factions | `GET /api/living-world/worlds/:worldLwsId/factions` | Returns `factions: [...]` |
| | Create faction | `POST /api/living-world/worlds/:worldLwsId/factions` | `{ name, description, ... }` |
| | Update faction | `PATCH /api/living-world/worlds/:worldLwsId/factions/:factionLwsId` | `{ name?, description?, ... }` |
| | Delete faction | `DELETE /api/living-world/worlds/:worldLwsId/factions/:factionLwsId` | HTTP 204 No Content |
| | List faction members | `GET /api/living-world/worlds/:worldLwsId/factions/:factionLwsId/members` | Returns `members: [...]` |
| | Add faction member | `POST /api/living-world/worlds/:worldLwsId/factions/:factionLwsId/members` | `{ character_lws_id, role, rank }` |
| | Remove faction member| `DELETE /api/living-world/worlds/:worldLwsId/factions/:factionLwsId/members/:charLwsId` | HTTP 204 No Content |
| | List world rules | `GET /api/living-world/worlds/:worldLwsId/world-rules` | Returns `rules: [...]` |
| | Create world rule | `POST /api/living-world/worlds/:worldLwsId/world-rules` | `{ title, body, sort_order }` |
| | Update world rule | `PATCH /api/living-world/worlds/:worldLwsId/world-rules/:ruleLwsId` | `{ title?, body?, sort_order? }` |
| | Delete world rule | `DELETE /api/living-world/worlds/:worldLwsId/world-rules/:ruleLwsId` | HTTP 204 No Content |
| | List archetypes | `GET /api/living-world/worlds/:worldLwsId/ambient-archetypes` | Returns `archetypes: [...]` |
| | Create archetype | `POST /api/living-world/worlds/:worldLwsId/ambient-archetypes` | `{ name, description, category, default_attributes, tags }` |
| | Update archetype | `PATCH /api/living-world/worlds/:worldLwsId/ambient-archetypes/:archetypeLwsId` | `{ name?, description?, category?, default_attributes?, tags? }` |
| | Delete archetype | `DELETE /api/living-world/worlds/:worldLwsId/ambient-archetypes/:archetypeLwsId` | HTTP 204 No Content |
| | List scenarios | `GET /api/living-world/worlds/:worldLwsId/scenarios` | Returns `scenarios: [...]` |
| | Create scenario | `POST /api/living-world/worlds/:worldLwsId/scenarios` | `{ name, description, starting_location_id, opening_narrative, sort_order }` |
| | Update scenario | `PATCH /api/living-world/worlds/:worldLwsId/scenarios/:scenarioLwsId` | `{ name?, description?, starting_location_id?, opening_narrative?, sort_order? }` |
| | Delete scenario | `DELETE /api/living-world/worlds/:worldLwsId/scenarios/:scenarioLwsId` | HTTP 204 No Content |
| | Add scenario character | `POST /api/living-world/worlds/:worldLwsId/scenarios/:scenarioLwsId/characters` | `{ character_lws_id, role, custom_prompt_notes }` |
| | Remove scenario char | `DELETE /api/living-world/worlds/:worldLwsId/scenarios/:scenarioLwsId/characters/:charLwsId` | HTTP 204 No Content |
| | Get prompt config | `GET /api/living-world/worlds/:worldLwsId/prompt-config` | Returns `prompt_config: {...}` |
| | Update prompt config | `PATCH /api/living-world/worlds/:worldLwsId/prompt-config` | `{ system_prompt_template?, layer_budgets?, enabled_layers? }` (Note: Backend `POST /prompt-config` exists for initial creation outside Phase 12 UI flow) |
| **Phase 11 Import** | Card preview | `POST /api/living-world/import/character/preview` | `multipart/form-data` (`file`, optional `world_lws_id`) |
| | Card commit | `POST /api/living-world/worlds/:worldLwsId/import/character` | `{ preview_token, conflict_policy, custom_name? }` |
| | Lorebook preview | `POST /api/living-world/import/worldinfo/preview` | `multipart/form-data` (`file`, optional `world_lws_id`) |
| | Lorebook commit | `POST /api/living-world/worlds/:worldLwsId/import/worldinfo` | `{ preview_token, conflict_policy, decisions? }` |
| | Freeform preview | `POST /api/living-world/import/freeform/preview` | `{ text, world_lws_id? }` |
| | Freeform commit | `POST /api/living-world/worlds/:worldLwsId/import/freeform` | `{ preview_token, conflict_policy, accepted_entities? }` |
| | Manifest preview | `POST /api/living-world/import/manifest/preview` | `application/json` or `application/x-yaml` text |
| | Manifest commit | `POST /api/living-world/import/manifest/commit` | `{ preview_token, conflict_policy, custom_world_name? }` |
| | Manifest export | `GET /api/living-world/worlds/:worldLwsId/export/manifest?format=json\|yaml` | Returns JSON or formatted YAML string |
| **Simulation Runtime** | List simulations | `GET /api/living-world/worlds/:worldLwsId/simulations` | Returns `simulations: [...]` |
| | Create simulation | `POST /api/living-world/worlds/:worldLwsId/simulations` | `{ scenario_lws_id, name, initial_fictional_time }` |
| | Get simulation | `GET /api/living-world/simulations/:simLwsId` | Returns simulation row (`world_lws_id`, `name`, `status`, `current_fictional_time`) |
| | Update simulation | `PATCH /api/living-world/simulations/:simLwsId` | `{ name?, status?, current_location_lws_id? }` |
| | Delete simulation | `DELETE /api/living-world/simulations/:simLwsId` | HTTP 204 No Content |
| | List sim characters | `GET /api/living-world/simulations/:simLwsId/characters` | Returns `characters: [...]` |
| **Narrative Generation** | Generate Turn | `POST /api/living-world/simulations/:simLwsId/generate` | `{ generation_mode, user_prompt, perspective_character_lws_id? }` |
| | Build context (debug) | `POST /api/living-world/simulations/:simLwsId/prompt-context/build` | `{ generation_mode, user_prompt, perspective_character_lws_id? }` |
| | List turn history | `GET /api/living-world/simulations/:simLwsId/turns` | Returns `turns: [...]` |
| | List sim events | `GET /api/living-world/simulations/:simLwsId/events` | Returns `events: [...]` |
| | Verify replay parity | `POST /api/living-world/simulations/:simLwsId/replay-verify` | Returns `{ match: true, stats: {...} }` |
| **Temporal Progression** | Advance time | `POST /api/living-world/simulations/:simLwsId/time-advance` | `{ advance_seconds?, target_fictional_time?, step_size_seconds? }` |
| | Schedule event | `POST /api/living-world/simulations/:simLwsId/scheduled-events` | `{ trigger_fictional_time, event_type, payload }` |
| | Cancel scheduled | `POST /api/living-world/simulations/:simLwsId/scheduled-events/:eventLwsId/cancel` | `{ reason }` |
| | Set routines | `PUT /api/living-world/simulations/:simLwsId/characters/:charLwsId/routines` | `{ routine_blocks: [...] }` |
| **Camera & Perspective**| Get camera state | `GET /api/living-world/simulations/:simLwsId/camera` | Returns `{ mode, target_character_lws_id, target_location_lws_id }` |
| | Set camera mode | `POST /api/living-world/simulations/:simLwsId/camera` | `{ mode, target_character_lws_id?, target_location_lws_id? }` |
| | Subjective perspective| `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/perspective` | Returns character's perceived facts, memories, beliefs |
| | Observer perspective | `GET /api/living-world/simulations/:simLwsId/observer/perspective` | Returns privileged global ground truth |
| **Cognition & Mind** | Character cognition | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/cognition` | Returns needs, goals, values, emotions |
| | Character needs | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/needs` | Returns 5 need dimensions ($[0, 100]$) |
| | Character goals | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/goals` | Returns active acute & background goals |
| | Character intentions | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/intentions` | Returns current intention sequence |
| | Character values | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/values` | Returns moral values & veto weights |
| | Trigger deliberation | `POST /api/living-world/simulations/:simLwsId/characters/:charLwsId/deliberate` | `{ reason? }` |
| **Social & Relationships**| Social graph | `GET /api/living-world/simulations/:simLwsId/social/graph` | Returns nodes & directional edges |
| | Relationships | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships` | Returns outgoing relationship ratings |
| | Specific relationship| `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId` | Returns specific pair dimensions |
| | Relationship evidence| `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId/evidence` | Returns interaction evidence records |
| | Character factions | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/factions` | Returns faction memberships |
| | Development ledger | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/development` | Returns causal growth events |
| | Known rumors | `GET /api/living-world/simulations/:simLwsId/characters/:charLwsId/known-rumors` | Returns perceived rumors |
| **Environment & Crowd** | Location environment | `GET /api/living-world/simulations/:simLwsId/locations/:locLwsId/environment` | Returns weather, lighting, hazards |
| | Operational state | `GET /api/living-world/simulations/:simLwsId/locations/:locLwsId/operational-state` | Returns locked/damaged/operational state |
| | Ambient population | `GET /api/living-world/simulations/:simLwsId/locations/:locLwsId/ambient-population` | Returns ephemeral crowd members |
| | Population tiers | `GET /api/living-world/simulations/:simLwsId/population-tiers` | Returns CORE / SUPPORTING / AMBIENT roster |
| | Promoted entities | `GET /api/living-world/simulations/:simLwsId/promoted-entities` | Returns promotion provenance records |
| **Director Interventions**| Need override | `PUT /api/living-world/simulations/:simLwsId/characters/:charLwsId/needs/:needName` | `{ value, reason }` |
| | Belief injection | `PUT /api/living-world/simulations/:simLwsId/characters/:charLwsId/beliefs/:subjectKey` | `{ belief_text, confidence, evidence_type }` |
| | Goal injection | `POST /api/living-world/simulations/:simLwsId/characters/:charLwsId/goals` | `{ title, description, priority, category }` |
| | Social intervention | `POST /api/living-world/simulations/:simLwsId/social-interventions` | `{ social_state, actor_character_id?, target_character_id?, rationale? }` |
| | Env intervention | `POST /api/living-world/simulations/:simLwsId/environment-interventions` | `{ location_lws_id, operational_state?, environment?, reason? }` |
| | Entity promotion | `POST /api/living-world/simulations/:simLwsId/promotions` | `{ transient_id, target_tier, authored_character_lws_id?, reason? }` |
| | Raw narrative event | `POST /api/living-world/simulations/:simLwsId/events` | `{ event_type: "DIRECTOR_NOTE", payload: { note: "...", narrative: "..." } }` |

---

## 5. Exact Session Hydration & Reconnection Sequence

`GET /api/living-world/simulations/:simLwsId` returns solely the simulation row (`world_lws_id`, `name`, `status`, `current_fictional_time`). To hydrate the client workspace on initial load or reload, the UI executes the following sequence:

```
                  ┌──────────────────────────────────────────────┐
                  │ 1. Read accountStorage: 'lws_last_sim_id'    │
                  └──────────────────────┬───────────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
                 [Key Found]                      [Key Missing / Empty]
                         │                               │
       ┌─────────────────┴─────────────────┐             │
       ▼                                   │             │
┌──────────────────────────────────────┐   │             │
│ 2. GET /simulations/:simLwsId        │   │             │
└──────────────┬───────────────────────┘   │             │
               │                           │             │
       ┌───────┴───────┐                   │             │
       ▼               ▼                   │             │
  [HTTP 200]       [HTTP 404]              │             │
       │               │                   │             │
       │               └───────┬───────────┘             │
       │                       ▼                         ▼
       │         ┌──────────────────────────────────────────────┐
       │         │ 2a. Clear accountStorage 'lws_last_sim_id'   │
       │         │ 2b. GET /worlds                              │
       │         │ 2c. Render World & Simulation Browser UI     │
       │         └──────────────────────────────────────────────┘
       ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. Fetch Session State in Parallel:                          │
│    - GET /simulations/:simLwsId/camera                       │
│    - GET /simulations/:simLwsId/characters                   │
│    - GET /simulations/:simLwsId/turns                        │
└──────────────────────────────┬───────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
 [follow_character]   [observe_location]          [god_view]
       │                       │                       │
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ 4a. Fetch:    │       │ 4b. Fetch:    │       │ 4c. Fetch:    │
│ - Perspective │       │ - Environment │       │ - Observer    │
│ - Cognition   │       │ - Operational │       │   Perspective │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
        ┌──────────────────────────────────────────────┐
        │ 5. Render Full LWS Workspace & Start Clock   │
        └──────────────────────────────────────────────┘
```

1. **Client Startup:** UI checks `accountStorage.getItem('lws_last_sim_id')`.
2. **Simulation Validation:**
   - Dispatches `GET /api/living-world/simulations/:simLwsId`.
   - On **HTTP 404** (or empty key): clears cached key and calls `GET /api/living-world/worlds` to render World/Simulation selection.
3. **Parallel Stream & Camera Hydration (on HTTP 200):**
   - `GET /api/living-world/simulations/:simLwsId/camera` $\to$ gets active mode and target IDs.
   - `GET /api/living-world/simulations/:simLwsId/characters` $\to$ gets active roster.
   - `GET /api/living-world/simulations/:simLwsId/turns` $\to$ gets chronological turn stream.
4. **Epistemic Inspector Hydration:**
   - Mode `follow_character`: `GET .../perspective` + `GET .../cognition`.
   - Mode `observe_location`: `GET .../environment` + `GET .../operational-state`.
   - Mode `god_view`: `GET .../observer/perspective`.
5. **Workspace Assembly:** Mounts narrative stream in `#lws-narrative-stream`, mounts Mind Inspector cards in `#lws-mind-inspector`, and sets top-bar status badges.

---

## 6. Corrected Authority & Director Console Contract

### 6.1 Superseded Specifications
> [!WARNING]
> **SUPERSEDED CONTRACT NOTICE:**  
> All prior drafting describing `/lws-director event [type] [payload]` as arbitrary state mutation, or using non-canonical URLs such as `/time/advance`, is **EXPLICITLY SUPERSEDED**.  
> The frontend UI and slash commands **never** expose or attempt generic arbitrary state mutations.

### 6.2 Authoritative Director Operation Mapping
In accordance with Phase 4 (`ADR-012`) and Phase 5 (`ADR-013`), LWS enforces a strict **One Authoritative Path** policy:
- Generic `POST /simulations/:simLwsId/events` rejects mutation types that have dedicated domain routes with HTTP `422 Unprocessable Entity (DEDICATED_ROUTE_REQUIRED)`.
- Generic `POST /events` is permitted **only** for non-stateful narrative annotations (`event_type: "DIRECTOR_NOTE"`, payload: `{ note: "...", narrative: "..." }`).
- All Director Console controls and slash commands invoke dedicated domain endpoints:

| Director Action | Slash Command | Canonical Dedicated Route | Payload / Parameters |
|---|---|---|---|
| **Advance Time** | `/lws-time advance 1h` | `POST /simulations/:id/time-advance` | `{ advance_seconds: 3600 }` |
| **Set Fictional Clock** | `/lws-time-set [timestamp]` | `POST /simulations/:id/time-advance` | `{ target_fictional_time: "..." }` |
| **Switch Camera** | `/lws-camera follow [char]` | `POST /simulations/:id/camera` | `{ mode: 'follow_character', target_character_lws_id: '...' }` |
| **Narrative Annotation** | `/lws-director note [text]` | `POST /simulations/:id/events` | `{ event_type: 'DIRECTOR_NOTE', payload: { note: '...', narrative: '...' } }` |
| **Override Need** | `/lws-director need [char] [name] [val]` | `PUT /simulations/:id/characters/:charId/needs/:needName` | `{ value: 80, reason: 'Director override' }` |
| **Inject Belief** | `/lws-director belief [char] [key] [text]` | `PUT /simulations/:id/characters/:charId/beliefs/:subjectKey` | `{ belief_text: '...', confidence: 90, evidence_type: 'DIRECTOR' }` |
| **Inject Goal** | `/lws-director goal [char] [title]` | `POST /simulations/:id/characters/:charId/goals` | `{ title: '...', description: '...', priority: 80, category: 'ACUTE' }` |
| **Social Intervention** | `/lws-director social [src] [tgt] [dim] [delta]` | `POST /simulations/:id/social-interventions` | `{ social_state: { relationship: {...} }, rationale: '...' }` |
| **Weather / Hazard** | `/lws-director env [loc] [weather]` | `POST /simulations/:id/environment-interventions` | `{ location_lws_id: '...', environment: { weather_conditions: '...' } }` |
| **Promote Character** | `/lws-director promote [transient_id]` | `POST /simulations/:id/promotions` | `{ transient_id: '...', target_tier: 'SUPPORTING' }` |

---

## 7. Non-Browser Automated Verification Strategy

In strict adherence to the **AGENTS Browser Verification Prohibition**, Phase 12 verification is executed **without browser automation, Playwright, Puppeteer, DevTools, or screenshots**.

All tests run in standard Node environment using Jest (`tests/jest.config.json`) and native Node `fetch` against in-memory Express instances (`http.createServer(app)`):

### 7.1 Planned Dedicated Phase 12 Test Suites (Post-Authorization Verification Gate):

```text
tests/living-world/
├── lws-ui-state.test.js                      # Unit: UI reactive state store, active selection, accountStorage sync
├── lws-ui-templates.test.js                  # Unit: Template string rendering, attribute binding, strict XSS escaping
├── lws-ui-api-client.test.js                 # Unit: Typed REST API client wrappers against Express test server
├── lws-ui-slash-commands.test.js             # Unit: SlashCommandParser command registration, arguments, and handlers
├── lws-ui-workflow-integration.test.js       # Integration: Full Node/API user workflow against real SQLite DB
├── lws-ui-epistemic-camera.test.js           # Epistemic: Multi-character autonomy & perspective isolation proofs
└── lws-ui-static-contracts.test.js           # Static: Semantic HTML landmarks, ARIA attributes, CSS class scoping
```

### 7.2 Module-to-Test Evidence Matrix (Planned Verification Target Contracts):

| Frontend Module | Responsible Test Suite(s) | Required Verification Contracts (Planned Verification Target) |
|---|---|---|
| **`index.js`** | `lws-ui-static-contracts.test.js` | Must verify exported bootstrap API surface, top-bar mount element markup, and event listener registration contracts via static source inspection. |
| **`state.js`** | `lws-ui-state.test.js` | Must verify reactive state store event emission, property mutation tracking, `accountStorage` sync, and state reset on 404. |
| **`api.js`** | `lws-ui-api-client.test.js`<br>`lws-ui-workflow-integration.test.js` | Must verify HTTP verb/URL serialization, ST header attachment, multi-part form data uploads, error code parsing, and live endpoint invocation across all required LWS REST routes. |
| **`templates.js`** | `lws-ui-templates.test.js`<br>`lws-ui-static-contracts.test.js` | Must verify semantic HTML landmarks (`<main>`, `<nav>`, `<aside>`), mandatory `escapeHtml` XSS sanitization, ARIA attributes, and progress bar calculations. |
| **`slash-commands.js`** | `lws-ui-slash-commands.test.js` | Must verify registration with `SlashCommandParser`, help definitions, argument validation, and dispatch to dedicated API routes. |
| **`ui-shell.js`** | `lws-ui-static-contracts.test.js`<br>`lws-ui-templates.test.js` | Must verify workspace DOM structure, header status elements (world, sim, clock, camera), and scoped `.lws-*` CSS class conformance. |
| **`ui-world-browser.js`** | `lws-ui-templates.test.js`<br>`lws-ui-workflow-integration.test.js` | Must verify world/scenario card markup, selection dispatch, full World CRUD lifecycle (Create, Read, Update, Delete), full Scenario CRUD lifecycle (Create, Read, Update, Delete), and Simulation CRUD lifecycle (Create, Read, Update, Delete) with scenario launch. |
| **`ui-authored-roster.js`** | `lws-ui-templates.test.js`<br>`lws-ui-workflow-integration.test.js` | Must verify roster listing templates, full entity lifecycle for Character CRUD (Create, Read, Update, Delete), Location CRUD (Create, Read, Update, Delete), Faction CRUD (Create, Read, Update, Delete), World Rule CRUD (Create, Read, Update, Delete), Ambient Archetype CRUD (Create, Read, Update, Delete), Faction Membership management (List, Add, Remove), Scenario Roster management (List, Add, Remove), and Prompt Config management (Get, Update via PATCH). |
| **`ui-import-wizard.js`** | `lws-ui-api-client.test.js`<br>`lws-ui-templates.test.js`<br>`lws-ui-workflow-integration.test.js` | Must verify Phase 11 2-stage import modal rendering, preview diff display, conflict policy review, and HMAC commit workflow. |
| **`ui-narrative-view.js`** | `lws-ui-templates.test.js`<br>`lws-ui-workflow-integration.test.js` | Must verify narrative turn bubble formatting, user prompt input dispatch, and `/generate` turn completion. |
| **`ui-mind-inspector.js`** | `lws-ui-templates.test.js`<br>`lws-ui-epistemic-camera.test.js` | Must verify cognitive bar styling, perspective filtering, and strict suppression of NPC private thoughts. |
| **`ui-director-console.js`** | `lws-ui-templates.test.js`<br>`lws-ui-api-client.test.js`<br>`lws-ui-workflow-integration.test.js` | Must verify dedicated intervention form rendering, time advance controls (`POST /time-advance`), social/environment intervention payload formatting, and character tier promotion requests (`POST /promotions`). |

---

## 8. Final Measurable Phase 12 Acceptance Criteria

Phase 12 will be accepted only when all of the following criteria are proven with automated test evidence:

- [ ] **AC-1 (Complete Native UI Component Workflow):** The full LWS lifecycle is designed, implemented, and verified via automated Node unit/integration tests without browser execution, explicitly covering:
  - **World:** Create, Read, Update, Delete (`POST /worlds`, `GET /worlds`, `GET /worlds/:id`, `PATCH /worlds/:id`, `DELETE /worlds/:id`);
  - **Scenario:** Create, Read, Update, Delete (`POST /worlds/:id/scenarios`, `GET /worlds/:id/scenarios`, `GET /worlds/:id/scenarios/:id`, `PATCH /worlds/:id/scenarios/:id`, `DELETE /worlds/:id/scenarios/:id`);
  - **Character:** Create, Read, Update, Delete (`POST /worlds/:id/characters`, `GET /worlds/:id/characters`, `GET /worlds/:id/characters/:id`, `PATCH /worlds/:id/characters/:id`, `DELETE /worlds/:id/characters/:id`);
  - **Location:** Create, Read, Update, Delete (`POST /worlds/:id/locations`, `GET /worlds/:id/locations`, `GET /worlds/:id/locations/:id`, `PATCH /worlds/:id/locations/:id`, `DELETE /worlds/:id/locations/:id`);
  - **Faction:** Create, Read, Update, Delete (`POST /worlds/:id/factions`, `GET /worlds/:id/factions`, `GET /worlds/:id/factions/:id`, `PATCH /worlds/:id/factions/:id`, `DELETE /worlds/:id/factions/:id`);
  - **World Rule:** Create, Read, Update, Delete (`POST /worlds/:id/world-rules`, `GET /worlds/:id/world-rules`, `GET /worlds/:id/world-rules/:id`, `PATCH /worlds/:id/world-rules/:id`, `DELETE /worlds/:id/world-rules/:id`);
  - **Ambient Archetype:** Create, Read, Update, Delete (`POST /worlds/:id/ambient-archetypes`, `GET /worlds/:id/ambient-archetypes`, `GET /worlds/:id/ambient-archetypes/:id`, `PATCH /worlds/:id/ambient-archetypes/:id`, `DELETE /worlds/:id/ambient-archetypes/:id`);
  - **Faction Membership:** List, Add, Remove (`GET .../factions/:id/members`, `POST .../factions/:id/members`, `DELETE .../factions/:id/members/:charId`);
  - **Scenario Roster:** List, Add, Remove (`GET .../scenarios/:id`, `POST .../scenarios/:id/characters`, `DELETE .../scenarios/:id/characters/:charId`);
  - **Prompt Config:** Get, Update (`GET /worlds/:id/prompt-config`, `PATCH /worlds/:id/prompt-config`);
  - **Simulation Runtime:** Create, Read, Update, Delete (`POST /worlds/:id/simulations`, `GET /worlds/:id/simulations`, `GET /simulations/:id`, `PATCH /simulations/:id`, `DELETE /simulations/:id`), opening turn generation, dialogue turn dispatch, camera follow/observe, discrete time advance, and session reload.
- [ ] **AC-2 (Native SillyTavern Look & Feel & Theme Integration):** The UI strictly uses SillyTavern theme CSS variables (`--SmartThemeBodyColor`, `--SmartThemeBorderColor`, etc.), FontAwesome 6 icons, native popups (`popup.js`), toastr notifications, and responsive drawer conventions without CSS styling leakage outside `#lws-workspace`.
- [ ] **AC-3 (Multi-Character Autonomy Proof):**
  - **AC-3a (Authoritative Off-Camera State Progression):** Automated integration tests prove that advancing time via `POST /simulations/:simLwsId/time-advance` while following Character A (Dave) causes off-camera Character B (Charlotte) to execute routines/travel in SQLite independently. *(Responsible Suite: `lws-ui-epistemic-camera.test.js` & `lws-ui-workflow-integration.test.js`)*
  - **AC-3b (Epistemic Isolation & Zero Sensory Leakage):** Automated tests prove that Character A's subjective perspective (`GET .../perspective`) contains zero unperceived sensory information (e.g., `co_located_characters` does not list distant Charlotte), knowledge (`knowledge`), memories (`memories`), beliefs (`beliefs`), or other subjective fields originating from Charlotte's distant off-camera movement. *(Responsible Suite: `lws-ui-epistemic-camera.test.js`)*
  - **AC-3c (Camera Switch & Rehydration):** Automated tests prove that switching camera to Charlotte (`POST /simulations/:simLwsId/camera`) updates the active camera focus, and querying her subjective perspective (`GET .../characters/:charLwsId/perspective`) immediately reveals her authoritative location progression (`current_location`) and decayed needs over elapsed fictional time. Any verified memories must be causally created by simulation mechanisms and present in the documented subjective perspective; camera switching itself must never be described as creating memories or mutating character state. *(Responsible Suite: `lws-ui-epistemic-camera.test.js` & `lws-ui-state.test.js`)*
- [ ] **AC-4 (Epistemic Perspective Isolation):** In `follow_character` mode, the Mind Inspector displays only the focused character's permitted subjective cognition, needs, active goals, values, emotions, and memories. Private thoughts, secret beliefs, and unperceived events of other characters are strictly suppressed.
- [ ] **AC-5 (Authoritative Domain Route Conformance):** UI and Director Console operations strictly invoke existing authoritative REST endpoints in `src/endpoints/living-world.js`. Zero generic frontend mutations bypass domain validation or event authority pipelines.
- [ ] **AC-6 (Measurable Automated Non-Browser Verification):** Every Phase 12 frontend module and acceptance criterion has explicit automated test evidence across the 7 dedicated test suites (`lws-ui-state`, `lws-ui-templates`, `lws-ui-api-client`, `lws-ui-slash-commands`, `lws-ui-workflow-integration`, `lws-ui-epistemic-camera`, `lws-ui-static-contracts`) running in standard Node environment via Jest (`tests/jest.config.json`) and native `fetch` against in-memory Express instances, without browser automation, Playwright, Puppeteer, DevTools, screenshots, or JSDOM dependencies. All existing 78 LWS test suites continue to pass with zero regressions.
