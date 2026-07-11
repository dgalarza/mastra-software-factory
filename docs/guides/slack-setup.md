# Slack Setup

The factory posts its recommendation cards to a Slack channel. This guide
creates the bot from the manifest in the repo root and wires the two
environment variables the card path needs.

Use a **dedicated workspace** if you're going to record or screen-share —
keep real workspace content out of frame.

## 1. Create the app from the manifest

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
2. Choose **From a manifest** → select your workspace
3. Paste the contents of [`slack-app-manifest.yaml`](../../slack-app-manifest.yaml) (root of this repo)
4. Review the summary — it should ask for exactly one bot scope, `chat:write` — then **Create**

## 2. Install and grab the token

1. On the app's page: **Install App** → **Install to Workspace** → Allow
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

## 3. Create the channel and invite the bot

1. In Slack, create `#factory` (or whatever you want the factory channel to be)
2. In that channel: `/invite @factory`
   (with only `chat:write`, the bot can post solely in channels it's a member of — that's intentional)
3. Get the channel ID: click the channel name → **About** tab → Channel ID at the bottom (`C0…`)

## 4. Wire the environment

In `.env`:

```
SLACK_BOT_TOKEN=xoxb-…
SLACK_CHANNEL_ID=C0…
```

`SLACK_SIGNING_SECRET` stays empty for now — it's only needed once the
factory starts *receiving* Slack events (thread Q&A in a later station),
not for posting cards.

## 5. Verify

```bash
pnpm run dev
curl -X POST http://localhost:4111/dev/slack/hello
```

A "🏭 Factory channel online" card should land in the channel, and the curl
response should be `{"delivered":true,...}`.

## Troubleshooting

| Error in the response | Meaning |
|---|---|
| `SLACK_BOT_TOKEN is not set` | `.env` not loaded or var missing — the dev server reads `.env` from the repo root |
| `Slack API error: not_in_channel` | Bot isn't a member — `/invite @factory` in the channel |
| `Slack API error: channel_not_found` | Wrong `SLACK_CHANNEL_ID` (use the `C0…` ID, not the channel name) |
| `Slack API error: invalid_auth` | Token pasted wrong, or app was reinstalled (tokens rotate on reinstall) |
