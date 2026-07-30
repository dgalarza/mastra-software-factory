<!-- This file documents the business domain this codebase implements.
     It answers "what does this system do?" not "how is the code structured?"
     For code architecture, see ARCHITECTURE.md. -->

# Domain Knowledge

software-factory implements a **software factory**: a series of AI agents ("stations") with progressively increasing delegated scope. The governing idea is the **delegation ladder** — autonomy is not one dial you turn up; it scales per task with the task's scope, size, reversibility, and blast radius. Each station earns more scope than the last, and only after the previous rung has earned trust.

## The Factory Map (stations)

1. **Dependency triage** (Dependabot) — read-only recommendations from release notes *(built — Episode 1)*
2. **Executed evidence** — the same triage, now proving its claims by running the suite in a per-triage sandbox *(built — Episode 2)*
3. **Production-error triage** (Sentry) — clusters and explains incidents *(planned)*
4. **Ticket-to-PR** (Linear) — scoped ticket → draft PR *(planned)*
5. **Scaling** — running the factory across repos *(planned)*

Station 2 is a rung, not a second assembly line. It reuses Station 1's intake, agent, and output surface; what grows is the *evidence* behind a verdict and the scope the agent is trusted with to produce it. More evidence earns more confidence, not automatically more autonomy — the factory still only recommends.

## Glossary

- **Station** -- One rung of the factory: an agent (plus its tools, intake, and output surface) with an explicitly bounded scope of delegation.
- **Triage** -- The factory's job so far: read the release notes for every version a Dependabot PR bumps across, establish whether the change reaches this app, prove it against the suite, and recommend — without touching the repo.
- **Verdict** -- The structured output of a triage: `MERGE`, `HOLD`, or `NEEDS_REVIEW`, plus a risk class (`low`/`moderate`/`high`), card-sized reasoning, and a citation. Schema: `VerdictSchema` in `src/mastra/agents/verdict.ts`.
  - **MERGE** -- no change to existing behavior can reach this app. Either the notes show only additive or internal changes, or a breaking change exists and the agent has demonstrated it does not apply here.
  - **HOLD** -- a change to *existing* behavior this app can reach (changed default, altered API contract, revert, deprecation requiring action, dropped runtime support, security fix needing coordinated rollout).
  - **NEEDS_REVIEW** -- applicability could not be established: notes unreadable or absent, a grouped multi-dependency PR, or a blocked investigation. This means "I could not determine", never "this looked scary". A major bump is not automatically NEEDS_REVIEW; major means go find out.
- **The three honesty rules** -- What a verdict is *allowed to claim*. All three run in plain TypeScript after the agent has finished, in `src/mastra/agents/verdict.ts`, and the agent cannot author any of the evidence they check.
  - **Citation rule** -- Every MERGE/HOLD must quote, verbatim, the exact release-notes line it rests on and name the version it appeared in. No citation ⇒ NEEDS_REVIEW. `enforceCitationRule`.
  - **Evidence rule** -- A MERGE must be backed by a green, parseable suite run harvested from the sandbox. A failed run ⇒ HOLD, naming the failing example; an unverifiable run ⇒ NEEDS_REVIEW. `enforceEvidenceRule`.
  - **Probe rule** -- An assertion that stayed green while its subject was broken ⇒ HOLD at high risk, outranking whatever the notes supported. That is a finding about the *suite*, not the dependency. `enforceProbeRule`.
- **Executed evidence (Verification)** -- What the suite actually did, as opposed to what the agent says it did. RSpec writes a JSON artifact inside the sandbox; the workflow reads it off and parses it in `src/lib/rspec.ts`. `VerdictSchema` has no verification field at all, so the model cannot write this block.
- **Assertion probe** -- A mutation test of a *spec*, not of the app: `probe-assertion` (baked into the image) alters what an assertion checks, confirms the spec goes red, restores the tree, and appends its own record. Required whenever the bump touches test tooling, because a green suite after a test-framework upgrade means either "everything works" or "the assertions stopped asserting", and CI cannot tell those apart.
  - Probes report **three** states: `detected` (the spec caught the break), `missed` (it stayed green — a finding), and `errored` (the probe itself failed — inconclusive, reported but never counted as a finding). Collapsing `errored` into `missed` once shipped a card accusing a healthy suite of lying. Parsed by `src/lib/probes.ts`.
- **Investigation protocol** -- The agent's instructions are phases, not a command list: what changed (read every intermediate version, then verify against the shipped gem source) → does it reach this app (grep call sites, compare `Gemfile.lock` and `.ruby-version`) → baseline (check out the PR, run the suite) → test the tests (probe each assertion touching the changed surface) → decide. There is deliberately no `audit` tool and no scripted audit step.
- **Audit sandbox** -- The disposable Railway VM one triage runs in, forked from an immutable template in ~3s and destroyed afterwards. Inside it the agent has total freedom: edit files, delete code, break things on purpose. Acquisition is semaphore-bounded (4) so a Dependabot burst queues rather than stampedes; release is unconditional. `src/mastra/workspace.ts`.
- **Template** -- The immutable base image the sandboxes fork from (Ruby, Postgres, a weft clone, its gem bundle, the test schema, the probe helper). Built out-of-band by `pnpm build-template` and content-addressed by Railway, so an unchanged recipe rebuilds in ~0.2s. `src/lib/sandbox/recipe.ts`. **No audit sandbox may carry a `checkpointName`** — that arms a refresh that rewrites the shared base with whatever the last triage left behind. See ADR 004.
- **Read-only guardrail** -- The agent's access is deliberately asymmetric. Against the repo it has only read permissions (Pull requests, Contents, Metadata), enforced by GitHub's installation-token scoping — infrastructure, not prompting, and it has no write-capable tools. Inside its sandbox it has a root shell. The blast radius of that freedom is one VM that is about to be destroyed, and the credential it holds cannot push.
- **Two-credential model** -- Two GitHub credentials with deliberately different lifetimes: a long-lived read-only PAT builds the immutable base (it must be stable, or every rotation forces a rebuild), and short-lived App installation tokens minted per triage and delivered to sandbox tmpfs do the per-triage git. The long-lived one never touches a running audit, and no credential is ever written to sandbox disk or into a URL.
- **Recommendation card** -- The card posted to the factory Slack channel through the Channels Card API: verdict header, dependency bump, risk class, reasoning, the executed-evidence lines, the cited line as a quote block, PR link. The tests and assertions lines are workflow-authored from harvested artifacts. Rendered by `src/lib/slack.ts`, which escapes third-party text so a changelog line cannot smuggle `<!channel>` or a spoofed link onto a card the team trusts.
- **Grouped PR** -- A Dependabot PR bumping several dependencies at once. Classified NEEDS_REVIEW rather than unpacked.
- **Resolution chain** -- How release notes are found: RubyGems metadata → GitHub Releases in the version range → CHANGELOG file slicing → `found: false`. Implemented in `src/mastra/tools/get-release-notes.ts`.
- **Consistency harness** -- The record-ready gate: N runs of the full triage against one PR must produce the same verdict and the same cited line. `test/consistency/run-triage.ts`. Since Station 2 each run performs a full sandbox audit, so it is slow and metered — prefer small N.
- **Degraded (Episode 1) mode** -- Without Railway or GitHub credentials there is no sandbox. Triage still runs on release notes alone, and the evidence rule refuses to let it claim a MERGE it cannot prove. Missing evidence degrades a verdict; it never crashes a run or silently drops a triage.

## Core Workflows

### Dependabot Triage (Stations 1–2)
- **Trigger:** GitHub `pull_request` webhook (opened/reopened/synchronize) from `dependabot[bot]`, HMAC-verified against the raw body at `/webhooks/github`.
- **What happens:** One `triage-workflow` run per PR, in its own memory thread and its own sandbox. The agent calls `getDependencyPr` (what is bumped) and `getReleaseNotes` (every intermediate version's notes), then investigates in the sandbox: verifies the notes against the shipped gem source, greps for call sites, checks out the PR, runs the suite, and probes the assertions when test tooling changed. It returns a structured Verdict. The workflow then harvests the artifacts off the sandbox, applies the three honesty rules in code, renders the card, posts it, and binds the Slack thread to the memory thread for follow-up Q&A.
- **Outcome:** A recommendation card in the factory channel. The human merges — the factory never does.
- **Key models:** `triageAgent`, `triageWorkflow`, `VerdictSchema`, `Verification`, `ProbeSummary`, `getDependencyPr`, `getReleaseNotes`

## Domain Relationships

- A `Station` = intake (webhook route) + agent + tools + output surface (Slack channel). Station 2 adds a sandbox workspace to that set rather than a second one of each.
- One webhook event → exactly one workflow run → exactly one sandbox → exactly one Verdict → one card. Triages never share context, memory, or evidence across PRs.
- A `Verdict` cites at most one release-notes line; the line belongs to a specific version inside the bump range `(from, to]`.
- A `Verdict` carries a `Verification` and a `ProbeSummary` that the agent did not write. Both are built by the workflow from artifacts harvested off that run's sandbox.
- The rules compose in order — citation, then evidence, then probes — and each can only ever downgrade a verdict, never promote one.

## Known Limits

- Verdict stability is **not** guaranteed under Station 2. Five runs on one PR gave four MERGE and one HOLD with an identical citation every time; the HOLD came from a probe whose mutation changed something no spec asserts on. The system can verify that a probe ran and what it returned, but not that it asked a sensible question. That is the honest limit of the evidence rules.
- A green suite is a floor, not evidence. CI already ran it before the agent did; it means "nothing obvious broke", never "this change is safe".

## Regulatory / Compliance Context

None formally. The project's own governing constraint is the delegation ladder: no station may hold write scope it hasn't explicitly been granted on camera, and the factory's read-only claim against the repo must remain literally true at the infrastructure layer. Sandbox isolation is part of that claim — `ISOLATED` networking is set deliberately, because these sandboxes share an environment with a deployed weft service and must not reach it.
