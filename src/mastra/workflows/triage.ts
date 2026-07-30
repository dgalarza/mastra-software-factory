import type { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { VerdictSchema, enforceCitationRule, enforceEvidenceRule, enforceProbeRule, type Verdict } from '../agents/verdict';
import { acquireAuditSandbox, deliverCloneToken } from '../workspace';
import type { RailwaySandbox } from '@mastra/railway';
import { RequestContext } from '@mastra/core/di';
import { PROBE_ARTIFACT_PATH, RSPEC_ARTIFACT_PATH } from '../../lib/sandbox/recipe';
import { parseRspecArtifact, verificationError, VerificationSchema, type Verification } from '../../lib/rspec';
import { parseProbeArtifact, NO_PROBES, type ProbeSummary } from '../../lib/probes';
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
  repo: z.string().describe('Repository full name, e.g. "dgalarza/weft"'),
  prNumber: z.number().int(),
});

const ProbeRecordSchema = z.object({
  source: z.string(),
  spec: z.string(),
  status: z.enum(['detected', 'missed', 'errored']),
  exitCode: z.number().int(),
  failureCount: z.number().int(),
  note: z.string(),
});

const ProbeSummarySchema = z.object({
  ran: z.boolean(),
  total: z.number().int(),
  detected: z.number().int(),
  missed: z.array(ProbeRecordSchema),
  errored: z.array(ProbeRecordSchema),
});

const triageOutputSchema = z.object({
  verdict: VerdictSchema,
  /** Built from the rspec artifact by the workflow — never agent-authored. */
  verification: VerificationSchema,
  /** Built from the probe artifact by the workflow — never agent-authored. */
  probes: ProbeSummarySchema,
  /** Memory thread the triage ran in — the card's Slack thread binds to it. */
  threadId: z.string(),
  repo: z.string(),
  prNumber: z.number().int(),
});

const deliverySchema = z.object({
  verdict: VerdictSchema,
  verification: VerificationSchema,
  probes: ProbeSummarySchema,
  delivered: z.boolean(),
  deliveryError: z.string().nullable(),
  /** True when the Slack thread is bound + subscribed for follow-up Q&A. */
  threadBound: z.boolean(),
});

/**
 * Read the rspec artifact off THIS run's sandbox and parse it in code.
 *
 * Each triage forks its own sandbox from the immutable template, so an
 * artifact found here can only have come from this run — no cross-run
 * staleness to guard against, and concurrent triages cannot see each
 * other's evidence. No sandbox (credentials absent) is an error
 * verification: Episode 1 behavior, where verdicts remain possible but
 * MERGE cannot claim proof it does not have.
 */
async function harvestVerification(sandbox: RailwaySandbox | undefined): Promise<Verification> {
  if (!sandbox) return verificationError('no sandbox configured');
  try {
    const result = await sandbox.executeCommand('cat', [RSPEC_ARTIFACT_PATH], { timeout: 30_000 });
    if (result.exitCode !== 0) return verificationError('rspec artifact not found in sandbox');
    return parseRspecArtifact(result.stdout);
  } catch (err) {
    return verificationError(err instanceof Error ? err.message : String(err));
  }
}

/** Same contract as harvestVerification, for the probe artifact. */
async function harvestProbes(sandbox: RailwaySandbox | undefined): Promise<ProbeSummary> {
  if (!sandbox) return NO_PROBES;
  try {
    const result = await sandbox.executeCommand('cat', [PROBE_ARTIFACT_PATH], { timeout: 30_000 });
    // Absent artifact is not an error: most bumps never touch test tooling,
    // so most triages legitimately run no probes.
    if (result.exitCode !== 0) return NO_PROBES;
    return parseProbeArtifact(result.stdout);
  } catch {
    return NO_PROBES;
  }
}

const triageStep = createStep({
  id: 'triage',
  description: 'Agent reads the PR and its release notes, returns a structured verdict',
  inputSchema: triageInputSchema,
  outputSchema: triageOutputSchema,
  execute: async ({ inputData, mastra, runId }) => {
    const agent = mastra.getAgent('triageAgent');
    const logger = mastra.getLogger();
    const threadId = `triage-${runId}`;

    // One sandbox for this PR alone, forked from the immutable template.
    // Acquisition is slot-bounded, so a Dependabot burst queues instead of
    // stampeding. Undefined means credentials are absent — the triage still
    // runs, read-only, and the evidence rule refuses to let it claim a MERGE.
    const audit = await acquireAuditSandbox(runId).catch((err) => {
      logger?.error('Could not acquire an audit sandbox', {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    });
    if (!audit) logger?.warn('No audit sandbox — triaging on release notes alone');

    try {
    // Fresh short-lived clone credential for this triage (tmpfs — see
    // workspace.ts). Non-fatal: without it the fetch fails and the
    // evidence rule downgrades the verdict honestly.
    // Belt and braces: a fresh sandbox should hold no evidence, but a base
    // captured from a dirty state would smuggle a previous PR's artifacts in
    // — which is precisely how PR #52 came to report PR #38's "7/7
    // assertions verified" without ever running a probe. Deleting here makes
    // "the artifact exists" mean "this run produced it", independent of
    // whether the base was built cleanly.
    if (audit) {
      await audit.sandbox
        .executeCommand('rm', ['-f', RSPEC_ARTIFACT_PATH, PROBE_ARTIFACT_PATH], { timeout: 30_000 })
        .catch(() => undefined);
    }
    if (audit && !(await deliverCloneToken(audit.sandbox).catch(() => false))) {
      logger?.warn('No clone token delivered — sandbox audit cannot fetch the PR');
    }
    const result = await agent.generate(
      `Triage Dependabot pull request #${inputData.prNumber} in ${inputData.repo}.`,
      {
        // One fresh thread per run: the triage stays isolated from other
        // PRs, but everything it reads is remembered for thread follow-ups.
        memory: {
          thread: { id: threadId, title: `Triage ${inputData.repo}#${inputData.prNumber}` },
          resource: inputData.repo,
        },
        // The agent resolves its workspace from here, so its hands are
        // THIS run's sandbox and no other's.
        requestContext: new RequestContext([['workspace', audit?.workspace]]),
        structuredOutput: { schema: VerdictSchema },
        // The investigation protocol is step-hungry: source reading,
        // call-site greps, a baseline run, then a mutation probe per
        // assertion (two commands each — break it, restore it). 8 starved
        // the agent into returning no verdict at all on the first live run
        // (PR #52); 30 does not cover probing a suite's worth of matchers.
        maxSteps: 80,
      },
    );
    // No structured verdict (step budget exhausted, refusal, provider
    // hiccup) must degrade like every other missing evidence: a card the
    // human sees, never a crashed step and a silently dropped triage.
    const object = result.object as Verdict | undefined;
    const raw: Verdict = object ?? {
      verdict: 'NEEDS_REVIEW',
      riskClass: 'moderate',
      dependency: 'unknown',
      fromVersion: 'unknown',
      toVersion: 'unknown',
      citation: null,
      reasoning: 'The agent produced no structured verdict; triage requires human review.',
      prUrl: `https://github.com/${inputData.repo}/pull/${inputData.prNumber}`,
    };
    const cited = enforceCitationRule(raw);
    if (cited !== raw) {
      mastra.getLogger()?.warn('Uncited verdict downgraded to NEEDS_REVIEW', {
        original: raw.verdict,
        dependency: cited.dependency,
      });
    }
    // Station 2's honesty rule: the verdict must agree with the EXECUTED
    // evidence — the artifact the suite wrote, read off the sandbox and
    // parsed here in code. The agent's claims never author this block.
    const [verification, probes] = await Promise.all([
      harvestVerification(audit?.sandbox),
      harvestProbes(audit?.sandbox),
    ]);
    const evidenced = enforceEvidenceRule(cited, verification);
    // Probe rule runs last: an assertion that stayed green while its subject
    // was broken is a finding about the SUITE and outranks the notes-driven
    // verdict, which would otherwise describe the wrong problem.
    const verdict = enforceProbeRule(evidenced, probes);
    if (verdict !== cited) {
      mastra.getLogger()?.warn('Verdict downgraded by evidence rule', {
        original: cited.verdict,
        result: verification.result,
        reason: verification.errorReason,
      });
    }
    return { verdict, verification, probes, threadId, ...inputData };
    } finally {
      // Unconditional: a leaked sandbox survives to its idle timeout, and a
      // burst of leaks is how you discover the plan's concurrency cap.
      await audit?.release().catch((err) =>
        logger?.warn('Failed to release audit sandbox', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
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
    const { verdict, verification, probes, threadId } = inputData;
    const logger = mastra.getLogger();
    const undelivered = (deliveryError: string) => ({ verdict, verification, probes, delivered: false, deliveryError, threadBound: false });

    const sdk = mastra.getAgent('triageAgent').getChannels()?.sdk;
    const channelId = process.env.SLACK_CHANNEL_ID;
    const missing = !sdk
      ? 'Slack Channels not configured (SLACK_APP_TOKEN missing, or not yet connected)'
      : !channelId
        ? 'SLACK_CHANNEL_ID is not set'
        : null;
    if (missing) {
      logger?.error('Triage card delivery failed', { error: missing, verdict: verdict.verdict });
      return undelivered(missing);
    }

    try {
      const { card, fallbackText } = renderTriageCard({ ...verdict, verification, probes });
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

      return { verdict, verification, probes, delivered: true, deliveryError: null, threadBound };
    } catch (err) {
      // Keep the verdict inspectable in Studio even when delivery fails —
      // but fail loudly in the logs; a dropped card is a dropped triage.
      const message = err instanceof Error ? err.message : String(err);
      logger?.error('Triage card delivery failed', { error: message, verdict: verdict.verdict });
      return undelivered(message);
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
