import { z } from 'zod';

/**
 * The structured output contract for Station 1 triage. Lives apart from the
 * agent so the workflow, Slack renderer, and consistency harness can share
 * it without importing the agent (and its model wiring).
 */

export const VerdictSchema = z.object({
  verdict: z.enum(['MERGE', 'HOLD', 'NEEDS_REVIEW']),
  riskClass: z.enum(['low', 'moderate', 'high']),
  dependency: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  citation: z
    .object({
      version: z.string().describe('The release version the quoted line appeared in'),
      quote: z.string().describe('The exact line from the release notes, quoted verbatim'),
    })
    .nullable(),
  reasoning: z.string().max(280).describe('At most two sentences — card-sized'),
  prUrl: z.string(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * The factory's honesty rule, enforced in code rather than trusted to the
 * prompt: a MERGE or HOLD without a verbatim citation is not evidence-backed
 * and is downgraded to NEEDS_REVIEW.
 */
export function enforceCitationRule(verdict: Verdict): Verdict {
  if (verdict.verdict === 'NEEDS_REVIEW' || verdict.citation) return verdict;
  return {
    ...verdict,
    verdict: 'NEEDS_REVIEW',
    riskClass: verdict.riskClass === 'low' ? 'moderate' : verdict.riskClass,
    reasoning: `Downgraded from ${verdict.verdict}: the evidence rule requires a verbatim release-notes citation and none was provided.`,
  };
}
