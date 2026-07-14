# Documentation

Index of project documentation. Start here to find what you need.

## Architecture
- [ARCHITECTURE.md](../ARCHITECTURE.md) -- System overview, codemap, invariants, and boundaries
- [Station 1 overview diagram](./architecture/station-1-overview.png) -- Dependabot trigger through webhook intake, triage workflow, Slack delivery, and the follow-up loop ([interactive HTML](./architecture/station-1-overview.html))
- [Triage workflow diagram](./architecture/triage-workflow.png) -- Step-level view of `triage-workflow`: the agent's tool loop, the citation guardrail, and the Slack post/bind step ([interactive HTML](./architecture/triage-workflow.html))

## Domain Knowledge
- [DOMAIN.md](./DOMAIN.md) -- The software factory domain: stations, the delegation ladder, verdicts, and the evidence rule

## Guides
- [Slack Setup](./guides/slack-setup.md) -- Create the factory's Slack bot from [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) and wire the card delivery env vars

## References
- (none yet -- add API/schema references here as the project grows)

## Decisions
Architecture Decision Records (ADRs) capture significant decisions and their rationale.

- [001 - Agent-Ready Documentation Structure](./decisions/001-agent-ready-documentation.md) -- Adopts progressive disclosure docs for agent legibility
- [002 - Workflow Intake over Signals](./decisions/002-workflow-intake-over-signals.md) -- Why Station 1 triages via a workflow pipeline instead of signal subscriptions
- [003 - Channels + Per-PR Memory Threads for Slack](./decisions/003-channels-thread-qa.md) -- Thread Q&A: replies to a card are answered from the notes the agent read during that triage
