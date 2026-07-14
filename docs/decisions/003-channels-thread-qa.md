# 3. Mastra Channels + Per-PR Memory Threads for Slack

**Date:** 2026-07-11
**Status:** Accepted (supersedes the Slack-delivery portion of [ADR 002](./002-workflow-intake-over-signals.md))

## Context
Station 1 shipped with one-way Slack delivery: the workflow posted Block Kit cards via `chat.postMessage` and stopped. Replying to a card did nothing — the bot had no event subscriptions and could not hear. That was defensible for "rung one touches nothing," but "why HOLD?" asked into the void is a bad experience, and the triage context (the release notes the agent read) evaporated with each one-shot `generate()`.

## Decision
Mastra Channels (`@chat-adapter/slack`) is **how the factory does Slack**, with per-PR memory threads:

- The triage agent gets `Memory` (`lastMessages: 50` — tool results count as messages, and the fetched release notes are exactly what a follow-up needs to see) and a Slack channels adapter.
- Each triage runs in its own memory thread (`triage-<runId>`, `resource: <repo>`), preserving the one-verdict-per-PR isolation from ADR 002 while making the run's context durable.
- After the card posts, the workflow **binds** the Slack thread to the memory thread — setting the three metadata keys Channels uses for lookup (`channel_platform`, `channel_externalThreadId`, `channel_externalChannelId`, all required) — and **subscribes** it, so replies flow to the agent without an @mention and are answered from the notes the agent actually read.
- Card *posting* goes through the Channels SDK's Card API (`Card`/`CardText`/`Fields`/`Field` from `'chat'`, via `agent.getChannels()!.sdk.channel(...).post({ card, fallbackText })`) — reversed from the original raw-`chat.postMessage` design; see the 2026-07-13 update below.
- **Socket mode only** (`SLACK_APP_TOKEN`): the bot connects out to Slack, so no public URL or tunnel is ever needed for Slack events — in dev or in production. Webhook mode (`SLACK_SIGNING_SECRET`, an auto-mounted route with the adapter verifying Slack's signature) is supported by `@chat-adapter/slack` but deliberately unused here, to keep exactly one Slack integration path to document, wire, and demo.

## Consequences
- The Slack app needs more scope: `app_mentions:read`, `channels:history`, `channels:read`, `reactions:read`, `reactions:write`, `users:read` on top of `chat:write`, plus event subscriptions (`app_mention`, `message.channels`). The reaction scopes come from Channels' built-in add/remove-reaction tools, left enabled (the default) rather than turned off — still no DMs, no private channels. Scope widening is deliberate and visible, same pattern as the GitHub App.
- `createSlackAdapter()` throws at construction when credentials are missing, so the channels config is attached conditionally — the server always boots without Slack credentials. Card delivery now requires the same credentials as thread Q&A (see 2026-07-13 update) — there is no longer a bot-token-only fallback for cards.
- Binding order matters: metadata first, then `subscribe()` — subscribe silently no-ops if no thread carries the external-thread-id metadata yet.
- Reply runs are channel-backed: the agent's answer posts to the Slack thread automatically via the Channels output processor. The triage run itself is not channel-backed at generate time (metadata is bound after), so the verdict is not double-posted.
- Agent instructions now cover reply behavior, including not echoing raw `<`, `>`, or @-mention sequences from third-party notes (the Channels reply path posts markdown without escaping).

## Alternatives Considered
- **Stateless replies (no memory, agent re-fetches via tools per question)** -- workable but reconstructs context instead of remembering it; slower, costlier, and weaker as a demo of what the agent read.
- **Webhook mode** -- rejected outright, not just for local dev: it would need a second event-URL/tunnel story alongside GitHub's, a signing secret to manage, and a mode branch in code and docs — all to reach parity with what socket mode already does for free. One Slack mode is simpler for viewers to reproduce than "socket mode locally, webhook mode in prod."

## Update (2026-07-13): cards moved to the Card API
Originally cards posted via raw `chat.postMessage` (Block Kit JSON) specifically to avoid depending on Channels being configured — the `ep1-channel` checkpoint needed cards to work with just a bot token, no app token. That constraint no longer applies: the project now expects Channels to always be configured, so the decoupling argument is gone.

Reading the adapter's actual conversion source (`@chat-adapter/slack/dist/blocks.js`) settled the remaining question — does the Card API (`Card`, `CardText`, `Fields`, `Field`) reproduce our exact card layout? Yes, block-for-block: `Card({ title })` → `header`; `Fields([Field(...)])` → `section` with `fields[]` in the same `*label*\nvalue` format we hand-wrote; `CardText(text)` → `section`/mrkdwn. One gap: `CardLink` always renders as a full `section`, never the muted `context` block our footer uses — reproduced instead with `CardText(link, { style: 'muted' })`, hand-embedding Slack's `<url|label>` syntax.

Critically, `mrkdwn()` in the adapter's conversion path only truncates and converts `**bold**` → `*bold*` — it never calls `escapeSlackText`. So the Card API buys nothing on the injection front from ADR 003's original hardening pass; `escapeMrkdwn()` is still applied to all notes-derived text (citation, reasoning) before it reaches `CardText`/`Field`, exactly as before.

Posting now goes through `agent.getChannels()!.sdk.channel('slack:<id>').post({ card, fallbackText })` from `postCardStep` and the hello route (both already have `mastra` in scope). `lib/slack.ts` now only builds `CardElement`s — no `fetch`, no Mastra dependency, per this repo's `src/lib/` convention; the `postToSlack` helper and raw-Block-Kit rendering are gone. Tests convert the built card back to blocks via `cardToBlockKit()` (from `@chat-adapter/slack`) for assertions, so they verify the same delivered Slack shape as before.
