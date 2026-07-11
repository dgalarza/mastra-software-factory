# AGENTS.md

## Project
software-factory -- a [Mastra](https://mastra.ai/) project implementing a software factory: agents with progressively increasing delegated scope, built station by station. Station 1 is a read-only Dependabot triage agent (webhook intake → triage agent + tools → Slack recommendation card). See [docs/DOMAIN.md](docs/DOMAIN.md) for the domain model.

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
```bash
pnpm test                                  # vitest unit suite (offline, deterministic)
pnpm consistency <owner/repo> <pr> [n=10]  # N-run triage consistency harness (real APIs + model)
pnpm audit-queue <owner/repo>              # list open Dependabot PRs with parsed bump fields
```
The consistency harness is the record-ready gate: green N/N (same verdict, same cited line) before freezing model/prompt. It needs `OPENAI_API_KEY` plus GitHub credentials in `.env`.

## Architecture
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full codemap.
See [Domain Knowledge](docs/DOMAIN.md) for business concepts, terminology, and workflows.

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
- The triage agent's model and instructions are frozen for Episode 1 (`openai/gpt-5.2`) -- re-run `pnpm consistency` before and after any change to either. See [ADR 002](docs/decisions/002-workflow-intake-over-signals.md).
- Dependabot PR titles on CreatorSignal carry a `chore(deps):` prefix -- the parser in `src/lib/dependabot.ts` handles both prefixed and bare conventions; keep tests for both.
- Custom server routes must NOT start with `/api` (reserved by Mastra) and need `requiresAuth: false` to accept unauthenticated webhooks.
- `createSlackAdapter()` throws at construction when its credentials are missing -- always attach `channels` conditionally (see `slackChannels()` in `src/mastra/agents/triage.ts`) so the server boots without Slack creds.
- Slack thread ↔ memory thread binding needs ALL THREE metadata keys (`channel_platform`, `channel_externalThreadId`, `channel_externalChannelId`) set BEFORE `subscribe()` -- subscribe silently no-ops otherwise, and a missing key makes Channels create a duplicate thread with no triage context. See ADR 003.
- `pnpm test` stays offline/deterministic -- anything that hits real APIs or the model belongs in `pnpm consistency` or scripts, not the unit suite.

## Resources
- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)
