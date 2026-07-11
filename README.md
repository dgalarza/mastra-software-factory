# software-factory

A software factory built with [Mastra](https://mastra.ai/): a series of AI agents with progressively increasing delegated scope, built station by station in the open.

Station 1 is a **read-only Dependabot dependency-triage agent** — it reads the release notes you never would, classifies the risk of each dependency bump, and posts a recommendation card to Slack. It has no write access anywhere: the GitHub App it uses is scoped read-only, so it *cannot* merge, comment, or mutate the repo even if prompted to.

Checkpoints are tagged at episode act boundaries so you can follow the build commit by commit:

| Tag | State |
|-----|-------|
| `ep1-scaffold` | Clean Mastra scaffold + storage + env wiring |
| `ep1-webhook` | GitHub webhook intake: signature verification, Dependabot filtering, PR parsing |
| `ep1-channel` | Slack output surface: Block Kit recommendation cards |
| `ep1-complete` | Full triage loop: webhook → agent → recommendation card with cited evidence |

## Getting Started

Copy `.env.example` to `.env` and fill in your credentials — the Slack side can be created in two minutes from [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) (see the [Slack setup guide](./docs/guides/slack-setup.md)). Then start the development server:

```shell
pnpm install
pnpm run dev
```

Open [http://localhost:4111](http://localhost:4111) to access [Mastra Studio](https://mastra.ai/docs/studio/overview) — an interactive UI for building and testing agents, plus a REST API that exposes the application as a local service.

## Learn more

To learn more about Mastra, visit the [documentation](https://mastra.ai/docs/) — [agents](https://mastra.ai/docs/agents/overview), [tools](https://mastra.ai/docs/agents/using-tools), [workflows](https://mastra.ai/docs/workflows/overview), [scorers](https://mastra.ai/docs/evals/overview), and [observability](https://mastra.ai/docs/observability/overview).
