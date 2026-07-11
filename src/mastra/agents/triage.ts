import { Agent } from '@mastra/core/agent';
import type { ChannelConfig } from '@mastra/core/channels';
import { Memory } from '@mastra/memory';
import { createSlackAdapter } from '@chat-adapter/slack';
import { getDependencyPr } from '../tools/get-dependency-pr';
import { getReleaseNotes } from '../tools/get-release-notes';

/**
 * Station 1: read-only dependency triage.
 *
 * The agent reads what no human would — the release notes of every
 * intermediate version in a Dependabot bump — and recommends. It has no
 * write-capable tools, and the GitHub App behind its read tools has no
 * write permissions. It reads, it reasons, it recommends — and it stops.
 *
 * Each triage runs in its own memory thread, and the Slack card's thread is
 * bound to it — so replying to a card ("why HOLD?") reaches the agent with
 * the full triage context, including the release notes its tools returned.
 *
 * Model is frozen for Episode 1. Do not change it without re-running the
 * consistency harness (test/consistency/run-triage.ts).
 */

export { VerdictSchema, type Verdict, enforceCitationRule } from './verdict';

/**
 * Slack Channels attach, guarded: createSlackAdapter() throws at
 * construction when its credentials are missing, which would break server
 * boot — so only attach when a workable mode is configured.
 *   - SLACK_APP_TOKEN (xapp-)      → socket mode: no public URL needed; local dev
 *   - SLACK_SIGNING_SECRET         → webhook mode: /api/agents/triage-agent/channels/slack/webhook
 * Without either, cards still post (lib/slack.ts) but thread replies go unheard.
 */
function slackChannels(): ChannelConfig | undefined {
  if (!process.env.SLACK_BOT_TOKEN) return undefined;
  const adapter = process.env.SLACK_APP_TOKEN
    ? createSlackAdapter({ mode: 'socket' })
    : process.env.SLACK_SIGNING_SECRET
      ? createSlackAdapter()
      : undefined;
  if (!adapter) return undefined;
  // tools: false — the built-in channel tools (add/remove reaction) would
  // need reactions:* scopes; Station 1's bot stays minimal.
  return { adapters: { slack: adapter }, tools: false };
}

export const triageAgent = new Agent({
  id: 'triage-agent',
  name: 'Dependency Triage',
  description: 'Reads the release notes for a Dependabot bump and recommends MERGE, HOLD, or NEEDS_REVIEW with cited evidence.',
  instructions: `You triage Dependabot dependency-update pull requests. You are read-only: you recommend, humans decide.

For each PR:
1. Call getDependencyPr to learn what is being bumped.
2. Call getReleaseNotes for the full version range — read the notes for EVERY intermediate version, not just the target.
3. Classify using this rubric:

MERGE (riskClass low) — patch or minor bump whose notes show only bug fixes, internal refactors, docs, CI, dev-facing changes, or purely additive features (new APIs, options, or constants that are opt-in and leave existing behavior untouched). Additive is not a behavior change.

HOLD (riskClass moderate or high) — a change to EXISTING behavior a maintainer should look at before merging: a changed default, an altered return value or API contract of something that already existed, a deprecation that requires action, dropped support for a Ruby/Rails version, or a security fix that needs coordinated rollout. Ask: "if the app upgrades and changes nothing else, can its behavior differ?" If no, it is not a HOLD.

NEEDS_REVIEW — a major version bump, a grouped multi-dependency PR, ambiguous or unclear notes, or getReleaseNotes returning found: false. When you cannot read evidence, you do not guess.

Scan EVERY line of EVERY release in the range before deciding. Behavior-change signals that demand HOLD even when buried mid-list: "revert", "now", "no longer", "changed", "renamed", "removed", "deprecated", "defaults to", "drops/dropped support", or reworked "handling" of an existing option. A revert of an earlier change IS a behavior change. Lines that only add something new ("add X option", "add support for Y") are not.

Evidence requirement — this is absolute:
- A MERGE or HOLD verdict MUST cite the exact line from the release notes that supports it, quoted verbatim in citation.quote, with the version it appeared in as citation.version. For HOLD, quote the line describing the behavior change. For MERGE, quote the most significant line you cleared (or the line showing the release is fixes-only).
- If you cannot produce a verbatim citation, the verdict is NEEDS_REVIEW with citation: null.
- Never invent, paraphrase-as-quote, or cite text that is not in the notes.

Keep reasoning to two sentences maximum — it renders on a small card.

Follow-up questions: when someone replies in a triage card's Slack thread, answer from this conversation's history — you already read the release notes during the triage, so cite the specific lines that drove the verdict. If the history doesn't contain what you need, re-fetch with your tools rather than guessing. Keep answers short and plain. Never reproduce raw <, > or @-mention sequences from release notes in replies — describe them instead. You still recommend; humans decide. You cannot merge, comment on GitHub, or change anything, and you should say so if asked to act.`,
  model: 'openai/gpt-5.2',
  defaultOptions: {
    modelSettings: { temperature: 0.1 },
  },
  tools: { getDependencyPr, getReleaseNotes },
  // lastMessages must comfortably cover a triage run — tool results (the
  // fetched release notes) count as messages, and they're exactly what a
  // thread reply needs to see. The default of 10 scrolls them out.
  memory: new Memory({ options: { lastMessages: 50 } }),
  channels: slackChannels(),
});
