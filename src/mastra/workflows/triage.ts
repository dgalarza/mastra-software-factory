import type { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { VerdictSchema, enforceCitationRule } from '../agents/verdict';
import { renderTriageCard } from '../../lib/slack';

/**
 * The Station 1 pipeline: one run per Dependabot PR, so every PR gets
 * exactly one verdict and no triage shares context with another.
 *
 *   webhook → triage (agent reads PR + release notes via its tools) → card
 *
 * Each triage runs in its own memory thread; after the card posts, the
 * Slack thread is bound to that memory thread and subscribed, so replies
 * ("why HOLD?") reach the agent with the notes it actually read.
 *
 * Cards post through the agent's Channels SDK (Card API), not raw Slack
 * Web API calls — so card delivery now requires Channels to be configured
 * (SLACK_BOT_TOKEN + SLACK_APP_TOKEN), same as thread Q&A. See ADR 003.
 */

const triageInputSchema = z.object({
  repo: z.string().describe('Repository full name, e.g. "dgalarza/creatorsignal"'),
  prNumber: z.number().int(),
});

const triageOutputSchema = z.object({
  verdict: VerdictSchema,
  /** Memory thread the triage ran in — the card's Slack thread binds to it. */
  threadId: z.string(),
  repo: z.string(),
  prNumber: z.number().int(),
});

const deliverySchema = z.object({
  verdict: VerdictSchema,
  delivered: z.boolean(),
  deliveryError: z.string().nullable(),
  /** True when the Slack thread is bound + subscribed for follow-up Q&A. */
  threadBound: z.boolean(),
});

const triageStep = createStep({
  id: 'triage',
  description: 'Agent reads the PR and its release notes, returns a structured verdict',
  inputSchema: triageInputSchema,
  outputSchema: triageOutputSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const agent = mastra.getAgent('triageAgent');
    const threadId = `triage-${runId}`;
    const result = await agent.generate(
      `Triage Dependabot pull request #${inputData.prNumber} in ${inputData.repo}.`,
      {
        // One fresh thread per run: the triage stays isolated from other
        // PRs, but everything it reads is remembered for thread follow-ups.
        memory: {
          thread: { id: threadId, title: `Triage ${inputData.repo}#${inputData.prNumber}` },
          resource: inputData.repo,
        },
        structuredOutput: { schema: VerdictSchema },
        maxSteps: 8,
      },
    );
    const verdict = enforceCitationRule(result.object);
    if (verdict !== result.object) {
      mastra.getLogger()?.warn('Uncited verdict downgraded to NEEDS_REVIEW', {
        original: result.object.verdict,
        dependency: verdict.dependency,
      });
    }
    return { verdict, threadId, ...inputData };
  },
});

/**
 * Bind the posted card's Slack thread to the triage memory thread.
 *
 * Channels looks threads up by exactly these three metadata keys — all
 * three, ANDed. With them in place, a reply in the card's thread runs the
 * agent in the triage's own memory thread. subscribe() makes replies flow
 * without an @mention, and silently no-ops unless the metadata exists
 * first, so order matters here.
 */
async function bindCardThread(
  mastra: Mastra,
  { threadId, channel, ts }: { threadId: string; channel: string; ts: string },
): Promise<boolean> {
  const externalThreadId = `slack:${channel}:${ts}`;
  const store = await mastra.getStorage()?.getStore('memory');
  if (!store) return false;

  const thread = await store.getThreadById({ threadId });
  if (!thread) return false;
  await store.saveThread({
    thread: {
      ...thread,
      metadata: {
        ...thread.metadata,
        channel_platform: 'slack',
        channel_externalThreadId: externalThreadId,
        channel_externalChannelId: `slack:${channel}`,
      },
      updatedAt: new Date(),
    },
  });

  const sdk = mastra.getAgent('triageAgent').getChannels()?.sdk;
  if (!sdk) return false;
  await sdk.thread(externalThreadId).subscribe();
  return true;
}

const postCardStep = createStep({
  id: 'post-card',
  description: 'Post the verdict card to the factory channel and bind its thread for follow-up Q&A',
  inputSchema: triageOutputSchema,
  outputSchema: deliverySchema,
  execute: async ({ inputData, mastra }) => {
    const { verdict, threadId } = inputData;
    const logger = mastra.getLogger();

    const sdk = mastra.getAgent('triageAgent').getChannels()?.sdk;
    const channelId = process.env.SLACK_CHANNEL_ID;
    const missing = !sdk
      ? 'Slack Channels not configured (SLACK_APP_TOKEN missing, or not yet connected)'
      : !channelId
        ? 'SLACK_CHANNEL_ID is not set'
        : null;
    if (missing) {
      logger?.error('Triage card delivery failed', { error: missing, verdict: verdict.verdict });
      return { verdict, delivered: false, deliveryError: missing, threadBound: false };
    }

    try {
      const { card, fallbackText } = renderTriageCard(verdict);
      const sent = await sdk!.channel(`slack:${channelId}`).post({ card, fallbackText });
      logger?.info('Triage card delivered', { channel: channelId, ts: sent.id, verdict: verdict.verdict });

      let threadBound = false;
      try {
        threadBound = await bindCardThread(mastra, { threadId, channel: channelId!, ts: sent.id });
        if (!threadBound) {
          logger?.warn('Card thread not subscribed — replies will go unanswered', { threadId });
        }
      } catch (err) {
        logger?.warn('Card thread binding failed', { threadId, error: err instanceof Error ? err.message : String(err) });
      }

      return { verdict, delivered: true, deliveryError: null, threadBound };
    } catch (err) {
      // Keep the verdict inspectable in Studio even when delivery fails —
      // but fail loudly in the logs; a dropped card is a dropped triage.
      const message = err instanceof Error ? err.message : String(err);
      logger?.error('Triage card delivery failed', { error: message, verdict: verdict.verdict });
      return { verdict, delivered: false, deliveryError: message, threadBound: false };
    }
  },
});

export const triageWorkflow = createWorkflow({
  id: 'triage-workflow',
  description: 'Read-only Dependabot triage: fetch PR, read release notes, post a recommendation card',
  inputSchema: triageInputSchema,
  outputSchema: deliverySchema,
})
  .then(triageStep)
  .then(postCardStep)
  .commit();
