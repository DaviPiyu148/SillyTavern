# LWS Repository Structure

## Target layout

```text
SillyTavern/
├── AGENTS.md
├── src/
│   ├── existing ST modules
│   ├── endpoints/
│   │   ├── existing ST routers
│   │   └── living-world.js
│   └── living-world/
│       ├── domain/
│       ├── application/
│       ├── simulation/
│       ├── persistence/
│       ├── context/
│       ├── integration/
│       │   └── sillytavern/
│       └── index.js
├── public/
│   ├── existing ST assets
│   ├── scripts/
│   │   └── living-world/
│   └── css/
│       └── living-world/
├── data/
│   └── living-world/
├── tests/
│   └── living-world/
└── docs/
    └── living-world/
```

## Namespace rule

This is a responsibility boundary, not permission to create a directory for every conceptual engine. Split modules only when meaningful cohesion and ownership require it.

## API

Native LWS REST endpoints should use an obvious prefix such as `/api/living-world/*`.

## Frontend

Use `public/scripts/living-world/` and `public/css/living-world/`, reusing ST UI infrastructure.

## Persistence

Use `data/living-world/` for LWS-owned data.

## Tests

Use `tests/living-world/` and the host testing infrastructure.

## Existing ST files

Minimize changes outside the LWS namespace. When a change to an existing ST file is necessary, keep it narrow and stable: bootstrap, router registration, adapter, hook, or generation integration seam.

Avoid spreading LWS conditionals throughout unrelated ST features.
