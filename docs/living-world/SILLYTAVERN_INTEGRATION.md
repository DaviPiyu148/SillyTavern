# SillyTavern Integration

## Current host

The implementation target is `DaviPiyu148/SillyTavern`, `release` branch, as inspected for this documentation set.

The host is a JavaScript/Node.js SillyTavern application with the standard `src/`, `src/endpoints/`, `public/`, `public/scripts/`, `plugins/`, `data/`, and `tests/` structure.

## Intended integration shape

```text
src/
├── existing ST code
├── endpoints/
│   └── living-world.js
└── living-world/

public/
├── existing ST frontend
├── scripts/
│   └── living-world/
└── css/
    └── living-world/

data/
└── living-world/

tests/
└── living-world/
```

Use these as ownership namespaces. Do not create many directories until actual code cohesion requires them.

## Why not `plugins/`

LWS is core product functionality, not an optional third-party plugin. It needs controlled integration with lifecycle, characters, generation, prompt/context, persistence, and presentation.

## Backend

Use a dedicated `/api/living-world/*` REST boundary and a thin LWS router. Route handlers should authenticate/validate input, invoke LWS application services, and serialize results. Simulation logic does not belong in HTTP handlers.

## Frontend

LWS must use SillyTavern's existing UI/UX language. Reuse drawers, popups, buttons, inputs, templates, icons, typography, theme variables, responsive behavior, and message rendering when appropriate.

Do not introduce a second React/Vite app, theme system, design system, modal framework, or standalone frontend.

The goal is: “SillyTavern gained Living World mode.”

## Characters

Existing ST Character Cards should be importable through the LWS normalization pipeline. LWS runtime state remains separate from the authored card.

## World Info

Existing ST World Info/lorebooks can be an import/source channel. Normalize authoritative world concepts into LWS rather than making live prompt text the source of simulation truth.

## Generation

Do not duplicate provider implementations. LWS should build a semantic generation request and reuse SillyTavern's generation/provider path.

## Chat history

ST chat history is presentation/history, not the authoritative LWS simulation ledger. LWS may reference narrative turns/messages, but simulation events and runtime state live in LWS persistence.

## Server startup

Use the existing SillyTavern startup/router lifecycle. Do not create another HTTP server or process.

## Settings

Reuse ST model/generation settings and preset mechanisms where appropriate. Keep LWS-specific settings clearly namespaced.

## Integration principle

Before adding infrastructure, search the SillyTavern codebase for an existing equivalent and reuse it when semantics match.
