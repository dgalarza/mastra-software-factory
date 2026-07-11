# AGENTS.md

## Project
software-factory -- a [Mastra](https://mastra.ai/) project for building AI agents, tools, and workflows. Currently contains only Mastra's bootstrapped weather example; no product-specific domain has been defined yet.

## CRITICAL: Load the `mastra` skill first
Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge of Mastra APIs -- they change between versions.

## Build & Run
```bash
pnpm install     # Install dependencies
pnpm run build   # Build the project
pnpm run dev      # Start local dev server (Mastra Studio at http://localhost:4111)
```

## Session Startup
Before making changes, run through these steps to orient on a fresh context:
1. `pwd` -- confirm working directory
2. `git log --oneline -10` -- see recent work
3. `git fetch origin` -- refresh remote refs before comparing or integrating work
4. Bring the branch up to date with `origin/main`
5. Run `pnpm run dev` -- verify Mastra Studio starts cleanly
6. If anything is broken, fix that before starting new work

## Test
No test suite exists yet (`pnpm test` is a placeholder that exits with an error). Add real tests as agents/tools/workflows are built.

## Architecture
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full codemap.
See [Domain Knowledge](docs/DOMAIN.md) for business concepts, terminology, and workflows (currently a stub).

- All agents, tools, workflows, and scorers must be registered in `src/mastra/index.ts`
- Storage is a `MastraCompositeStore` (LibSQL default + DuckDB for observability) -- configured centrally in `index.ts`

## Key Conventions
- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly
- Tools own external HTTP calls; agents and workflows should not `fetch` directly outside a workflow step
- Never bypass the `SensitiveDataFilter` observability processor by logging raw request/response payloads elsewhere

## Definition of Done
A change is not complete until:
- The dev server (`pnpm run dev`) starts without errors
- The feature has been exercised end-to-end in Mastra Studio, not just written
- No new warnings in the dev server logs
- Commit message describes *why*, not just *what*

Do not mark work complete based on "the code looks right." Verify it actually runs in Mastra Studio.

## Common Workflows
See [docs/README.md](docs/README.md) for the documentation index. Guides will be added here as real workflows emerge (setup, testing, deployment).

## Architecture Decision Records
When making significant architectural decisions, create an ADR in [docs/decisions/](docs/decisions/). Write one when choosing between competing approaches, adopting/rejecting a major dependency, or establishing a cross-cutting pattern (auth, logging, error handling).

## Known Gotchas
- `docs/DOMAIN.md` is a stub pending real product requirements -- update it as soon as the actual domain is defined.

## Resources
- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)
