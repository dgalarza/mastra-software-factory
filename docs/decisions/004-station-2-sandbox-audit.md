# 4. Station 2: Executed Evidence in a Per-Triage Sandbox

**Date:** 2026-07-30
**Status:** Accepted

Consolidates and replaces the four ADRs drafted while this was being built
(004 sandbox-audit-workspace, 005 baked-weft-workspace, 006
per-run-sandboxes, and an unwritten 007 on templates). They recorded a
sequence of positions, several of which the next day's measurements
retired. This records where it landed and, more usefully, the measurements
that decided it.

## Context

Episode 1's triage read release notes and reasoned. Rung two needs
*executed* evidence: check out the Dependabot PR, run the suite, and
investigate what breaks. That raises four questions this ADR answers —
where code executes, who owns the base image, how the agent is prevented
from asserting evidence it doesn't have, and what happens when Dependabot
opens eleven PRs at once (weft's steady state).

## Decision

### The agent gets hands, not a scripted audit

The triage agent carries a Mastra `Workspace` backed by a Railway sandbox
and runs the audit itself through `execute_command`. There is no audit tool
and no deterministic audit step. Its instructions are an investigation
protocol (applicability → baseline → probe), not a command list.

Rejected: an `audit` tool or a fixed workflow step. Both make the "agent
with hands" premise false and duplicate what the Workspace already gives.
The failure they guarded against — fabricated results — is handled by
artifact harvesting instead, which is stronger because it doesn't depend on
the agent cooperating.

Rejected for Station 2: delegating to a coding harness over `@mastra/acp`.
It runs the harness as a *local child process*, so the suite would execute
on the operator's machine and the isolation claim would be false. An audit
also needs no file-editing loop. Revisit at Station 4 (ticket-to-PR), where
Railway now ships harnesses inside sandboxes natively.

### Evidence is enforced in code, never trusted from the model

The suite writes machine-readable artifacts; the workflow reads them off
the sandbox and builds the verdict's evidence itself.

- `rspec --format json --out` → parsed by `src/lib/rspec.ts`.
  `enforceEvidenceRule` downgrades a MERGE with no green, parseable run.
- `probe-assertion` (baked into the image) mutates what an assertion
  checks, confirms the spec goes red, restores the tree, and appends its
  own record. `enforceProbeRule` forces HOLD when an assertion stayed
  green while its subject was broken.

Exit codes are never the source of truth. Piping masks them — three audit
steps failed while reporting success through `tail` during development.

Probes report **three** states, not two: `detected`, `missed`, `errored`.
Collapsing `errored` into `missed` shipped a card claiming "5 of 7
assertions stayed green — the suite is not detecting what it claims to"
when four of those five were tooling failures (a locale default made Ruby
read rspec's UTF-8 JSON as US-ASCII, so every parse threw). "We could not
tell" and "your tests are lying to you" are different claims; only the
second is a finding.

The agent cannot author evidence at all: `VerdictSchema` has no
verification field. The workflow adds it.

### One sandbox per triage, forked from an immutable template

```
built template (Ruby 4.0.5, Postgres 17, weft clone, gems, test schema)
   ├── PR #38 → sandbox A → audit → destroy
   ├── PR #52 → sandbox B → audit → destroy      concurrent, isolated
   └── PR #56 → sandbox C → audit → destroy
```

Railway builds the ordered steps once, content-addresses the result, and
caches it; creating a sandbox forks that build in ~3s. Acquisition is
semaphore-bounded (4) so a burst queues rather than stampedes, and release
is unconditional in a `finally`.

**No sandbox carries a `checkpointName`, and that is load-bearing.**
`@mastra/railway` arms a refresh timer whenever one is set and captures
live disk state ~10s before idle teardown — which silently rewrites the
shared base with whatever the last audit left behind. This is not
hypothetical: it happened. The base ended up holding PR #38's
`/tmp/probes.jsonl`, `/tmp/rspec.json`, and its checked-out branch, and PR
#52 restored all of it and reported "7/7 assertions verified" for probes it
never ran. Templates have no mutable base, so the failure is now
unreachable rather than defended against.

Rejected: **checkpoints** (the original design) for exactly that reason.
Rejected: **`fork()` from a live base** — also checkpoint-free, but it
requires keeping a sandbox alive purely to fork from: a shared runtime
dependency and single point of failure under precisely the burst this
design exists for. Rejected: **`clone()`/derive with a per-PR checkpoint** —
`options.checkpointName ?? this._checkpointName` means `undefined` inherits
the parent's, so a clone always has a name and always refreshes into it; a
per-PR name also has no cached build on first use. `clone()` is the right
tool one layer up: Station 5 across repos wants one base per repo, the
"fleet of independent sandboxes" its own doc comment describes.

## Measurements that drove this

| Finding | Consequence |
| --- | --- |
| Template build **during** `create` 504s at Railway's 120s gateway; `build()` out-of-band takes ~60s | Heavy steps (gem install) live in the template, built by `pnpm build-template` |
| Identical recipe rebuilds in **0.2s**; a rotated token in `withEnv` forces **56s** | Build credential must be a STABLE value |
| Railway `${{shared.*}}` references resolve **empty** inside sandboxes at both build and runtime — verified against a literal control and a variable confirmed present | The PAT value is inline in `withEnv`; the reference approach is unavailable, not merely less clean |
| `@mastra/railway` silently ignores a **pre-built** `SandboxTemplate` and provisions a bare sandbox; the callback form works | `auditTemplate` is a callback. Regression-checked by `/dev/template-probe`, which re-takes the measurement inside the dev-server bundle rather than a loose script |
| Sandbox `exec` on an idle-destroyed sandbox **returns** exit -1 rather than throwing | Mastra's own restart-retry never fires; per-run sandboxes avoid the stale-handle problem entirely |
| GitHub App with `metadata`+`pull_requests` can read PRs but **not clone** — 404, indistinguishable from a missing repo | `contents: read` is required. Documented in `.env.example` |

## Consequences

- Concurrent triages are safe; evidence cannot cross runs. Verified: two
  sandboxes created 30ms apart, each carrying only its own findings.
- Per-triage cost is ~90s end to end (fork, checkout, delta bundle,
  migrate, suite, probes) and one ~60s template build per recipe change.
- Two credentials with different lifetimes, deliberately: a long-lived
  read-only PAT builds the immutable base; short-lived App installation
  tokens (~1h, minted per triage, delivered to `/dev/shm`) do per-triage
  git. The long-lived one never touches a running audit.
- `pg-up` clears a stale `postmaster.pid` and recreates the socket
  directory on a persistent path, not tmpfs. Keep it defensive.
- Without Railway or GitHub credentials the factory degrades to Episode 1:
  read-only triage, MERGE blocked for want of a verifiable run.
- `ISOLATED` networking is a guarantee, not a default. These sandboxes
  share an environment with a deployed weft service and must not reach it.
- Verdict stability is **not** guaranteed: 5 runs on PR #38 gave 4 MERGE
  and 1 HOLD with an identical citation every time. The HOLD came from a
  probe whose mutation changed something no spec asserts on — the system
  can verify that a probe ran and what it returned, but not that it asked a
  sensible question. That is the honest limit of the evidence rules.
