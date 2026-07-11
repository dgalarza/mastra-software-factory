import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { VerdictSchema, enforceCitationRule } from '../agents/verdict';
import { renderTriageCard, postToSlack } from '../../lib/slack';

/**
 * The Station 1 pipeline: one run per Dependabot PR, so every PR gets
 * exactly one verdict and no triage shares context with another.
 *
 *   webhook → triage (agent reads PR + release notes via its tools) → card
 */

const triageInputSchema = z.object({
  repo: z.string().describe('Repository full name, e.g. "dgalarza/creatorsignal"'),
  prNumber: z.number().int(),
});

const deliverySchema = z.object({
  verdict: VerdictSchema,
  delivered: z.boolean(),
  deliveryError: z.string().nullable(),
});

const triageStep = createStep({
  id: 'triage',
  description: 'Agent reads the PR and its release notes, returns a structured verdict',
  inputSchema: triageInputSchema,
  outputSchema: VerdictSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('triageAgent');
    const result = await agent.generate(
      `Triage Dependabot pull request #${inputData.prNumber} in ${inputData.repo}.`,
      {
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
    return verdict;
  },
});

const postCardStep = createStep({
  id: 'post-card',
  description: 'Render the verdict as a Block Kit card and post it to the factory channel',
  inputSchema: VerdictSchema,
  outputSchema: deliverySchema,
  execute: async ({ inputData, mastra }) => {
    try {
      const result = await postToSlack(renderTriageCard(inputData));
      mastra.getLogger()?.info('Triage card delivered', { ...result, verdict: inputData.verdict });
      return { verdict: inputData, delivered: true, deliveryError: null };
    } catch (err) {
      // Keep the verdict inspectable in Studio even when delivery fails —
      // but fail loudly in the logs; a dropped card is a dropped triage.
      const message = err instanceof Error ? err.message : String(err);
      mastra.getLogger()?.error('Triage card delivery failed', { error: message, verdict: inputData.verdict });
      return { verdict: inputData, delivered: false, deliveryError: message };
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
