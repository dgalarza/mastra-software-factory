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
  // 280 was sized for a single sentence about a changelog and truncated
  // evidence-rich reasoning mid-word on the first real investigation run
  // (PR #38). Counts and versions now live in structured fields rendered
  // as their own card lines, so this stays prose — but with headroom.
  reasoning: z.string().max(600).describe('Two or three sentences — renders on a card'),
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

/**
 * The factory's second honesty rule, Station 2's sibling of the citation
 * rule above: a verdict's claims must be consistent with the EXECUTED
 * evidence — the rspec artifact the workflow read off the sandbox, parsed
 * in code the model never touches.
 *
 * The two-dimensional rubric this enforces:
 *
 *                     notes clean          notes show behavior change
 *   tests pass    MERGE — now proven       still HOLD (suite doesn't
 *                                          cover what changed)
 *   tests fail    HOLD, failing example    HOLD, doubly
 *                 as proof
 *
 * The agent owns the notes dimension (it read the release notes); this
 * rule owns the tests dimension (the artifact says what ran). More
 * evidence earns more confidence, not automatically more autonomy.
 */
import type { Verification } from '../../lib/rspec';
import type { ProbeSummary } from '../../lib/probes';
export type { ProbeSummary } from '../../lib/probes';

export function enforceProbeRule(verdict: Verdict, probes: ProbeSummary): Verdict {
  // A spec that stays green while its subject is broken is asserting
  // nothing. That is a finding about the SUITE, not the dependency, and it
  // outranks any verdict the notes support — including a HOLD, whose
  // reasoning would otherwise point at the wrong problem.
  if (!probes.ran || probes.missed.length === 0) return verdict;
  const first = probes.missed[0];
  return {
    ...verdict,
    verdict: 'HOLD',
    riskClass: 'high',
    reasoning: `Downgraded: ${probes.missed.length} of ${probes.total} assertion(s) stayed green while their subject was broken (e.g. ${first.spec}). The suite is not detecting what it claims to.`,
  };
}

export function enforceEvidenceRule(verdict: Verdict, verification: Verification): Verdict {
  // Only MERGE claims proof; HOLD and NEEDS_REVIEW already withhold it.
  if (verdict.verdict !== 'MERGE') return verdict;

  if (verification.result === 'pass') return verdict;

  if (verification.result === 'fail') {
    const example = verification.failingExamples[0];
    return {
      ...verdict,
      verdict: 'HOLD',
      riskClass: verdict.riskClass === 'low' ? 'moderate' : verdict.riskClass,
      reasoning: `Downgraded from MERGE: the suite failed ${verification.failureCount} example(s)${example ? `, e.g. "${example}"` : ''}.`,
    };
  }

  // error: the run can't be proven to have happened. A MERGE without a
  // verifiable run is exactly as unacceptable as one without a citation.
  return {
    ...verdict,
    verdict: 'NEEDS_REVIEW',
    riskClass: verdict.riskClass === 'low' ? 'moderate' : verdict.riskClass,
    reasoning: `Downgraded from MERGE: no verifiable test run (${verification.errorReason ?? 'unknown error'}).`,
  };
}
