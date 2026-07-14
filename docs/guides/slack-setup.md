# Slack Setup

The factory posts recommendation cards to a Slack channel and answers
follow-up questions in each card's thread — both through Mastra Channels
(`@chat-adapter/slack`) and its Card API, not a separate Slack client. This
guide creates the bot from the manifest in the repo root and wires the
three environment variables the whole path needs — all three are required;
there's no bot-token-only fallback.

Use a **dedicated workspace** if you're going to record or screen-share —
keep real workspace content out of frame.

## 1. Create the app from the manifest

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
2. Choose **From a manifest** → select your workspace
3. Paste the contents of [`slack-app-manifest.yaml`](../../slack-app-manifest.yaml) (root of this repo)
4. Review the summary — seven bot scopes (post, hear mentions/replies, react) and Socket Mode — then **Create**

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
over a WebSocket, so no public URL or tunnel is ever needed for Slack
events — in local dev or in a deployed factory. This is the only mode the
project uses; there's no webhook alternative to configure.

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
agent actually read, not reconstructed. Cards post through the same
Channels SDK that answers replies, so `SLACK_APP_TOKEN` is required for
card delivery too — there's no bot-token-only mode.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `Slack Channels not configured (SLACK_APP_TOKEN missing, or not yet connected)` | `.env` missing `SLACK_APP_TOKEN`/`SLACK_BOT_TOKEN`, `.env` not loaded, or the socket hasn't finished connecting yet (check boot logs for "Slack socket mode connected") |
| `SLACK_CHANNEL_ID is not set` | var missing from `.env` |
| An error mentioning `not_in_channel` | Bot isn't a member — `/invite @factory` in the channel |
| An error mentioning `channel_not_found` | Wrong `SLACK_CHANNEL_ID` (use the `C0…` ID, not the channel name) |
| An error mentioning `invalid_auth` | Token pasted wrong, or app was reinstalled (tokens rotate on reinstall) |
| Card posts but thread replies get no answer | App not reinstalled after manifest update (missing `channels:history`/`app_mentions:read`), or the bot lacks the scope |
| Replies answered only after @mention | Thread subscription failed — look for "Card thread not subscribed" in the logs |
