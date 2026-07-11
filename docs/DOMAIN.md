<!-- This file documents the business domain this codebase implements.
     It answers "what does this system do?" not "how is the code structured?"
     For code architecture, see ARCHITECTURE.md. -->

# Domain Knowledge

software-factory implements a **software factory**: a series of AI agents ("stations") with progressively increasing delegated scope. The governing idea is the **delegation ladder** — autonomy is not one dial you turn up; it scales per task with the task's scope, size, reversibility, and blast radius. Each station earns more scope than the last, and only after the previous rung has earned trust.

## The Factory Map (stations)

1. **Dependency triage** (Dependabot) — read-only recommendations *(built — Episode 1)*
2. **PR review** — reads diffs, posts review notes *(planned)*
3. **Production-error triage** (Sentry) — clusters and explains incidents *(planned)*
4. **Ticket-to-PR** (Linear) — scoped ticket → draft PR *(planned)*
5. **Scaling** — running the factory across repos *(planned)*

## Glossary

- **Station** -- One rung of the factory: an agent (plus its tools, intake, and output surface) with an explicitly bounded scope of delegation.
- **Triage** -- Station 1's job: read the release notes for every version a Dependabot PR bumps across, classify the risk, and recommend — without touching the repo.
- **Verdict** -- The structured output of a triage: `MERGE`, `HOLD`, or `NEEDS_REVIEW`, plus a risk class (`low`/`moderate`/`high`), card-sized reasoning, and a citation. Schema: `VerdictSchema` in `src/mastra/agents/triage.ts`.
  - **MERGE** -- notes show only fixes, internal changes, or purely additive opt-in features.
  - **HOLD** -- a change to *existing* behavior a maintainer should see first (changed default, altered API contract, revert, deprecation requiring action, dropped runtime support, security fix needing coordinated rollout).
  - **NEEDS_REVIEW** -- major bump, grouped PR, ambiguous notes, or no notes resolvable. The agent never guesses.
- **Citation (evidence requirement)** -- Every MERGE/HOLD verdict must quote, verbatim, the exact release-notes line it rests on and name the version it appeared in. No citation ⇒ NEEDS_REVIEW. This is the factory's core honesty rule.
- **Read-only guardrail** -- Station 1's GitHub App has only read permissions (Pull requests, Contents, Metadata), enforced by GitHub's installation-token scoping — infrastructure, not prompting. The agent also has no write-capable tools.
- **Recommendation card** -- The Block Kit card posted to the factory Slack channel: verdict header, dependency bump, risk class, the cited line as a quote block, PR link. Rendered by `src/lib/slack.ts`.
- **Grouped PR** -- A Dependabot PR bumping several dependencies at once. Station 1 classifies these NEEDS_REVIEW rather than unpacking them.
- **Resolution chain** -- How release notes are found: RubyGems metadata → GitHub Releases in the version range → CHANGELOG file slicing → `found: false`. Implemented in `src/mastra/tools/get-release-notes.ts`.
- **Consistency harness** -- The record-ready gate: N runs of the full triage against one PR must produce the same verdict and the same cited line. `test/consistency/run-triage.ts`.

## Core Workflows

### Dependabot Triage (Station 1)
- **Trigger:** GitHub `pull_request` webhook (opened/reopened/synchronize) from `dependabot[bot]`, HMAC-verified at `/webhooks/github`.
- **What happens:** One `triage-workflow` run per PR. The triage agent calls `getDependencyPr` (what is bumped) and `getReleaseNotes` (every intermediate version's notes), classifies per the rubric, and returns a structured Verdict; the workflow renders it as a card and posts to Slack.
- **Outcome:** A recommendation card in the factory channel. The human merges — the factory never does.
- **Key models:** `triageAgent`, `triageWorkflow`, `VerdictSchema`, `getDependencyPr`, `getReleaseNotes`

## Domain Relationships

- A `Station` = intake (webhook route) + agent + tools + output surface (Slack channel).
- One webhook event → exactly one workflow run → exactly one Verdict → one card. Triages never share context across PRs.
- A `Verdict` cites at most one release-notes line; the line belongs to a specific version inside the bump range `(from, to]`.

## Regulatory / Compliance Context

None formally. The project's own governing constraint is the delegation ladder: no station may hold write scope it hasn't explicitly been granted on camera, and Station 1's read-only claim must remain literally true at the infrastructure layer.
