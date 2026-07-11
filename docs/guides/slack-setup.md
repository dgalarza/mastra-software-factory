# Slack Setup

The factory posts recommendation cards to a Slack channel and answers
follow-up questions in each card's thread (Mastra Channels). This guide
creates the bot from the manifest in the repo root and wires the three
environment variables that path needs.

Use a **dedicated workspace** if you're going to record or screen-share —
keep real workspace content out of frame.

## 1. Create the app from the manifest

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
2. Choose **From a manifest** → select your workspace
3. Paste the contents of [`slack-app-manifest.yaml`](../../slack-app-manifest.yaml) (root of this repo)
4. Review the summary — five bot scopes (post + hear mentions/replies, nothing else) and Socket Mode — then **Create**

Already created the app from an older manifest? **App settings → App
Manifest** → paste the current file → Save, then **reinstall** the app
(Install App → Reinstall) so the new scopes take effect. Reinstalling
rotates the bot token — update `SLACK_BOT_TOKEN`.

## 2. Install and grab the tokens

1. **Install App** → **Install to Workspace** → Allow
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
3. **Basic Information → App-Level Tokens → Generate Token and Scopes**:
   name it anything (e.g. `socket`), add scope **`connections:write`**,
   Generate, and copy the token (starts with `xapp-`)

The app-level token powers **Socket Mode**: the bot connects out to Slack
over a WebSocket, so local development needs no public URL or tunnel for
Slack events. (A deployed factory can use webhook mode instead — set
`SLACK_SIGNING_SECRET` and point the app's event subscriptions at
`/api/agents/triage-agent/channels/slack/webhook`.)

## 3. Create the channel and invite the bot

1. In Slack, create `#factory` (or whatever you want the factory channel to be)
2. In that channel: `/invite @factory`
3. Get the channel ID: click the channel name → **About** tab → Channel ID at the bottom (`C0…`)

## 4. Wire the environment

In `.env`:

```
SLACK_BOT_TOKEN=xoxb-…
SLACK_CHANNEL_ID=C0…
SLACK_APP_TOKEN=xapp-…
```

Restart `pnpm run dev` after changing `.env`.

## 5. Verify

```bash
pnpm run dev
curl -X POST http://localhost:4111/dev/slack/hello
```

A "🏭 Factory channel online" card should land in the channel with
`{"delivered":true,...}` in the curl response.

Then verify the Q&A loop: trigger a triage (redeliver a Dependabot webhook,
or wait for a real one), and when the card lands, **reply in its thread**
with something like "why this verdict?" — the agent answers from the
release notes it read during that triage. No @mention needed: the workflow
subscribes the bot to each card's thread.

## How the thread Q&A works

Each triage runs in its own Mastra memory thread (including the release
notes its tools fetched). After posting the card, the workflow binds the
Slack thread to that memory thread and subscribes it. Replies run the same
agent in the same memory thread — so "why HOLD?" is answered from what the
agent actually read, not reconstructed. Without `SLACK_APP_TOKEN` (or a
signing secret), cards still post; replies just go unheard.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `SLACK_BOT_TOKEN is not set` | `.env` not loaded or var missing — the dev server reads `.env` from the repo root |
| `Slack API error: not_in_channel` | Bot isn't a member — `/invite @factory` in the channel |
| `Slack API error: channel_not_found` | Wrong `SLACK_CHANNEL_ID` (use the `C0…` ID, not the channel name) |
| `Slack API error: invalid_auth` | Token pasted wrong, or app was reinstalled (tokens rotate on reinstall) |
| Card posts but thread replies get no answer | `SLACK_APP_TOKEN` missing (Channels not attached — check boot logs), app not reinstalled after manifest update, or the bot lacks `channels:history` |
| Replies answered only after @mention | Thread subscription failed — look for "Card thread not subscribed" in the logs |
