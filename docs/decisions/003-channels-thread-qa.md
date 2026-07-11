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
- Card *posting* stays on `chat.postMessage` with our Block Kit renderer (the chat SDK's `post()` does not accept raw Block Kit); Channels owns everything inbound.
- **Socket mode** for local dev (`SLACK_APP_TOKEN`): the bot connects out to Slack, so only GitHub needs the tunnel. Webhook mode (`SLACK_SIGNING_SECRET`, auto-mounted route `/api/agents/triage-agent/channels/slack/webhook` with the adapter verifying Slack signatures itself) is the deployed path.

## Consequences
- The Slack app needs more scope: `app_mentions:read`, `channels:history`, `channels:read`, `users:read` on top of `chat:write`, plus event subscriptions (`app_mention`, `message.channels`). Still read-and-reply only — no reactions (channel tools disabled), no DMs, no private channels. Scope widening is deliberate and visible, same pattern as the GitHub App.
- `createSlackAdapter()` throws at construction when credentials are missing, so the channels config is attached conditionally — the server must always boot without Slack credentials, and cards must still post with just a bot token (replies then require an @mention *and* Channels attached, so effectively: no app token, no Q&A).
- Binding order matters: metadata first, then `subscribe()` — subscribe silently no-ops if no thread carries the external-thread-id metadata yet.
- Reply runs are channel-backed: the agent's answer posts to the Slack thread automatically via the Channels output processor. The triage run itself is not channel-backed at generate time (metadata is bound after), so the verdict is not double-posted.
- Agent instructions now cover reply behavior, including not echoing raw `<`, `>`, or @-mention sequences from third-party notes (the Channels reply path posts markdown without escaping).

## Alternatives Considered
- **Stateless replies (no memory, agent re-fetches via tools per question)** -- workable but reconstructs context instead of remembering it; slower, costlier, and weaker as a demo of what the agent read.
- **Cards through the chat SDK Card API** -- would replace a tested Block Kit renderer with a less expressive element set for no behavioral gain; `webClient`/`chat.postMessage` is the adapter's own escape hatch for raw blocks.
- **Webhook mode for local dev** -- works, but the quick-tunnel URL churns on every restart and Slack's event URL would need updating each time; socket mode removes that entirely.
