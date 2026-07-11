<!-- This file documents the business domain this codebase implements.
     It answers "what does this system do?" not "how is the code structured?"
     For code architecture, see ARCHITECTURE.md.
     Maintainers: update this when new domain concepts are introduced in code. -->

# Domain Knowledge

<!-- TODO: needs domain expert review -- this project currently contains only Mastra's bootstrapped
     weather example, not real product domain logic. Replace this file's contents once the actual
     product domain (what software-factory is for) is defined. -->

## Glossary

- **Agent** -- An LLM-backed assistant with instructions, a model, and a set of tools it can call to accomplish a task. Maps to `Agent` from `@mastra/core/agent`, e.g. `weatherAgent` in `src/mastra/agents/weather-agent.ts`.
- **Tool** -- A typed function an agent can invoke to fetch data or take an action, with input/output schemas validated by Zod. Maps to `createTool` in `src/mastra/tools/`, e.g. `weatherTool`.
- **Workflow** -- A deterministic, multi-step process composed of discrete steps that can call agents/tools along the way. Maps to `createWorkflow`/`createStep` in `src/mastra/workflows/`, e.g. `weatherWorkflow`.
- **Scorer** -- An evaluation function that grades agent output quality (e.g. tool-call appropriateness, completeness, translation accuracy) for observability. Maps to `src/mastra/scorers/weather-scorer.ts`.

<!-- TODO: needs domain expert review -- add the real business terms once product requirements exist. -->

## Core Workflows

### Weather Forecast + Activity Planning (example only)
- **Trigger:** A city name is submitted to `weatherWorkflow`.
- **What happens:** The `fetch-weather` step geocodes the city and pulls a forecast from Open-Meteo; the `plan-activities` step passes that forecast to `weatherAgent`, which streams back formatted activity suggestions.
- **Outcome:** A structured text response with weather summary and time-specific activity recommendations.
- **Key models:** `weatherWorkflow`, `weatherAgent`, `weatherTool`

<!-- TODO: needs domain expert review -- this is Mastra's bootstrap example, not a real business workflow.
     Replace with the actual workflows this product needs to support. -->

## Domain Relationships

<!-- TODO: needs domain expert review -- no real domain entities exist yet beyond the Mastra example. -->

- A `Workflow` composes one or more `Step`s, and a step may invoke an `Agent`.
- An `Agent` has zero or more `Tool`s and zero or more `Scorer`s attached to it.

## Regulatory / Compliance Context

<!-- TODO: needs domain expert review -- no regulatory context has been established for this project yet. -->
