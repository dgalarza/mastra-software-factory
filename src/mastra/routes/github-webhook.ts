import { registerApiRoute } from '@mastra/core/server';
import { verifyGithubSignature } from '../../lib/verify-signature';
import { parseDependabotPr } from '../../lib/dependabot';

const TRIAGED_ACTIONS = new Set(['opened', 'reopened', 'synchronize']);

/** Real pull_request payloads are well under this; Mastra applies no body
 * limit to custom routes, so cap before buffering the (unauthenticated) body. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * GitHub webhook intake for Dependabot PRs.
 *
 * Order matters: signature verification runs on the raw body before anything
 * else touches the payload. Non-Dependabot and irrelevant events are
 * acknowledged with 200 so GitHub doesn't retry them.
 *
 * Custom routes must live outside the reserved `/api` prefix.
 */
export const githubWebhookRoute = registerApiRoute('/webhooks/github', {
  method: 'POST',
  // Webhook auth is the HMAC signature, not the server's auth layer.
  requiresAuth: false,
  handler: async (c) => {
    const mastra = c.get('mastra');
    const logger = mastra.getLogger();

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      logger?.error('GITHUB_WEBHOOK_SECRET is not set; refusing webhook');
      return c.json({ error: 'webhook secret not configured' }, 503);
    }

    const contentLength = Number(c.req.header('content-length'));
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return c.json({ error: 'payload too large' }, 413);
    }

    // The exact bytes GitHub signed — read before any JSON parsing.
    const rawBody = await c.req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return c.json({ error: 'payload too large' }, 413);
    }
    const signature = c.req.header('X-Hub-Signature-256');
    if (!verifyGithubSignature(secret, rawBody, signature)) {
      logger?.warn('GitHub webhook rejected: bad signature');
      return c.json({ error: 'invalid signature' }, 401);
    }

    const event = c.req.header('X-GitHub-Event');
    if (event !== 'pull_request') {
      return c.json({ ignored: true, reason: `event ${event ?? 'unknown'}` }, 200);
    }

    const payload = JSON.parse(rawBody);

    if (payload.sender?.login !== 'dependabot[bot]') {
      return c.json({ ignored: true, reason: 'not dependabot' }, 200);
    }
    if (!TRIAGED_ACTIONS.has(payload.action)) {
      return c.json({ ignored: true, reason: `action ${payload.action}` }, 200);
    }

    const repo = payload.repository?.full_name as string;
    const prNumber = payload.pull_request?.number as number;
    const title = payload.pull_request?.title as string;
    const branch = payload.pull_request?.head?.ref as string;
    const parsed = parseDependabotPr(title, branch);

    logger?.info('Dependabot PR received', {
      repo,
      prNumber,
      title,
      branch,
      prUrl: payload.pull_request?.html_url,
      ...parsed,
    });

    // Fire-and-forget: GitHub expects a fast ack, the triage takes as long
    // as the reading takes. One workflow run per PR event.
    const workflow = mastra.getWorkflow('triageWorkflow');
    const run = await workflow.createRun();
    const { runId } = await run.startAsync({ inputData: { repo, prNumber } });
    logger?.info('Triage started', { runId, repo, prNumber });

    return c.json({ received: true, runId, repo, prNumber, ...parsed }, 202);
  },
});
