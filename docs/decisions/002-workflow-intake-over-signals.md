# 2. Workflow Pipeline Intake over Signal Subscriptions for Station 1

**Date:** 2026-07-11
**Status:** Accepted

## Context
Station 1 (Dependabot triage) needs an intake path from GitHub webhook to agent. Two Mastra-native options were spiked against @mastra/core 1.50.x:

- **Option A — WebhookSignalProvider:** subscribe a long-lived agent thread to the repo; webhook events become notification signals that wake the thread.
- **Option B — Workflow pipeline:** the webhook route starts one `triage-workflow` run per PR event; the agent runs as a workflow step with structured output.

Spike acceptance criteria: (1) event-driven agent runs, (2) exactly one structured verdict per PR with no cross-PR contamination, (3) signature verification in the route before any processing.

## Decision
Use **Option B, the workflow pipeline** (`webhook route → triage step → post-card step`).

Signals passed criterion 1 — a medium-priority notification does wake an idle subscribed thread event-driven, in-process, with no extra packages. But they fail criterion 2 by design: all of a repo's PRs deliver into the *same* agent thread, so triages accumulate shared conversational context, the agent receives a summary string rather than the full payload, and there is no per-event structured-output contract. Subscriptions are also in-memory per-process, adding a persistence obligation. The workflow gives one run per PR, a Zod-typed verdict per run, full control of the `generate()` call (frozen model, temperature, maxSteps), and a graph that is legible in Studio.

Related decisions made at the same time:
- **Slack cards post via the Web API** (`chat.postMessage` from the post-card step). Mastra Channels (`@chat-adapter/slack`) can post proactively but requires the initialized server's Chat SDK instance; the thread-level Q&A it enables remains a candidate flourish, not core to Station 1.
- **Model frozen at `openai/gpt-5.2`, temperature 0.1**, after the consistency harness ran green 10/10 (same verdict, same cited line) against the designated HOLD candidate. Do not change model or instructions without re-running `pnpm consistency`.

## Consequences
- Each PR triage is isolated; there is no cross-PR memory. If a future station wants conversational follow-up ("why HOLD?"), that becomes a thread-level feature (Channels) layered on top, not a change to intake.
- The webhook route owns filtering (Dependabot-only, relevant actions) and returns 202 immediately via `run.startAsync`.
- The signals vocabulary doesn't appear in Episode 1; the workflow graph is the on-camera explanation instead.

## Alternatives Considered
- **Signals (Option A)** -- rejected for cross-PR thread contamination and the missing per-event structured-output contract; revisit if a station genuinely wants a long-lived, conversational thread per resource.
- **Bare Express/Hono sidecar server** -- rejected; Mastra's `server.apiRoutes` keeps intake inside the one runtime and visible to Studio.

## Notes from the official docs (reviewed 2026-07-11)
The signal-providers doc ([mastra.ai/docs/long-running-agents/signal-providers](https://mastra.ai/docs/long-running-agents/signal-providers.md)) corroborates the decision and adds two facts:
- Signals are **beta**: "Breaking changes may occur without a major version bump until the API is stable." The episode tags are a viewer-facing spine that must keep building from checkout, so core intake should not sit on a beta surface this season.
- **`@mastra/github-signals`** (npm, 0.2.2) is a production signal provider that watches PRs and notifies threads about comments, review state, CI status, and merges. Its shape — a persistent thread following one PR's life — is wrong for Station 1's fan-out triage but is the natural starting point for **Station 2 (PR review)**; evaluate it there before hand-rolling intake.
