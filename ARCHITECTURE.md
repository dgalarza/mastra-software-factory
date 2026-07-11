# Architecture

## Overview
software-factory is a [Mastra](https://mastra.ai/) project for building AI agents, tools, and workflows. As of this writing it contains only Mastra's bootstrapped example (a weather agent, tool, and workflow) -- no product-specific domain logic has been added yet. This document describes the structural conventions Mastra imposes and will be extended as real agents, tools, and workflows are added.

## Codemap

### `src/mastra/` -- Application root
All Mastra primitives (agents, tools, workflows, scorers) are registered in `src/mastra/index.ts`, which constructs and exports the `Mastra` instance. This is the single composition root for the app.

Key modules:
- `index.ts` -- Composition root: registers workflows, agents, scorers, storage, logger, and observability
- `agents/` -- Agent definitions (e.g. `weather-agent.ts`)
- `tools/` -- Tool definitions consumed by agents (e.g. `weather-tool.ts`)
- `workflows/` -- Multi-step workflow definitions built from `createStep`/`createWorkflow` (e.g. `weather-workflow.ts`)
- `scorers/` -- Eval scorers attached to agents for observability/quality grading (e.g. `weather-scorer.ts`)

### `.agents/skills/mastra/` -- Mastra framework skill
Reference documentation for building with Mastra (core concepts, API references, migration guides, common errors). Load this before doing Mastra-specific work, per `AGENTS.md`.

## Invariants

- All agents, tools, workflows, and scorers must be registered in `src/mastra/index.ts` -- there is no auto-discovery.
- Storage is a `MastraCompositeStore`: a default `LibSQLStore` (`file:./mastra.db`) plus a `DuckDBStore` scoped to the `observability` domain. Do not instantiate ad-hoc storage elsewhere.
- Observability is centrally configured in `index.ts` with a `SensitiveDataFilter` span processor -- sensitive data (passwords, tokens, keys) is redacted before export. Do not bypass this by logging raw request/response payloads elsewhere.
- There is no custom HTTP server or routing layer -- the `mastra dev`/`mastra build`/`mastra start` scripts (via `@mastra/core`) own the runtime.
- There is no ORM or hand-written SQL -- persistence goes through Mastra's storage abstraction only.

## Boundaries

- `src/mastra/index.ts` is the only file that should import from all four primitive directories (`agents/`, `tools/`, `workflows/`, `scorers/`) to wire them together. Individual primitive files should not import each other's siblings directly except where a workflow step needs an agent (e.g. `weather-workflow.ts` calls `mastra.getAgent('weatherAgent')` at runtime rather than importing the agent module directly).
- Tools are the only place external HTTP calls should live (e.g. `weather-tool.ts` calls the Open-Meteo API). Agents and workflows should not make raw `fetch` calls directly except within a `createStep` execute function, mirroring the existing workflow pattern.

## Cross-Cutting Concerns

### Error Handling
No centralized error-handling layer exists yet. The example workflow throws plain `Error`s from step `execute` functions (e.g. "Location not found"). Follow this pattern until a project-specific error strategy is established.

### Logging & Observability
Structured logging via `PinoLogger` (configured in `index.ts`, level `info`). Observability events are exported to both Mastra Storage and the Mastra Platform (if `MASTRA_PLATFORM_ACCESS_TOKEN` is set), with sensitive data redacted via `SensitiveDataFilter`.

### Authentication & Authorization
None implemented yet -- this is a bootstrapped example project with no auth layer.

### Configuration
No `src/config.ts` or environment-based config module exists yet. Model IDs and other settings are currently hardcoded inline (e.g. `model: 'openai/gpt-5-mini'` in `weather-agent.ts`).
