import { z } from 'zod';

/**
 * RSpec JSON artifact parsing — the evidence half of Station 2's verdicts.
 *
 * The agent runs weft's suite itself (through its Workspace) with
 * `--format json --out /tmp/rspec.json`. The workflow then reads that file
 * off the sandbox and parses it HERE, in code the model never touches.
 * The verification block on a card is built from this artifact, not from
 * anything the agent claimed — the same enforcement shape as the citation
 * rule.
 *
 * Exit codes are deliberately not the source of truth: a piped command
 * reports the last pipeline stage's status, and during the Ep. 2 spike
 * three failed commands reported as passing exactly that way. The artifact
 * either parses and says what happened, or the run is an `error` — never
 * silently a pass.
 */

export const VerificationSchema = z.object({
  /** What the artifact establishes about the suite run. */
  result: z.enum(['pass', 'fail', 'error']),
  exampleCount: z.number().int().nullable(),
  failureCount: z.number().int().nullable(),
  pendingCount: z.number().int().nullable(),
  /** Full descriptions of failed examples, capped for card rendering. */
  failingExamples: z.array(z.string()),
  durationSeconds: z.number().nullable(),
  /** Why the run is an `error`, when it is one. */
  errorReason: z.string().nullable(),
});

/** One declaration per shape, derived — the VerdictSchema pattern. */
export type Verification = z.infer<typeof VerificationSchema>;

const MAX_FAILING_EXAMPLES = 10;

/** The artifact was never produced: the run didn't happen or died early. */
export function verificationError(reason: string): Verification {
  return {
    result: 'error',
    exampleCount: null,
    failureCount: null,
    pendingCount: null,
    failingExamples: [],
    durationSeconds: null,
    errorReason: reason,
  };
}

/**
 * Parse the raw contents of an rspec JSON report.
 *
 * Never throws — an unparseable or structurally surprising artifact is an
 * `error` verification, because "we cannot prove what happened" must not
 * be representable as a pass.
 */
export function parseRspecArtifact(raw: string): Verification {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return verificationError('rspec report is not valid JSON');
  }

  const summary = (doc as { summary?: unknown })?.summary as
    | { example_count?: unknown; failure_count?: unknown; pending_count?: unknown; duration?: unknown }
    | undefined;
  if (
    typeof summary?.example_count !== 'number' ||
    typeof summary?.failure_count !== 'number'
  ) {
    return verificationError('rspec report has no usable summary');
  }

  // errors_outside_of_examples (a spec file that fails to LOAD) reports
  // example_count 0 with failure_count 0 — treat an empty run as an error,
  // not a pass: weft's suite is never legitimately empty.
  if (summary.example_count === 0) {
    return verificationError('rspec ran zero examples');
  }

  const examples = Array.isArray((doc as { examples?: unknown }).examples)
    ? ((doc as { examples: unknown[] }).examples as Array<{ status?: unknown; full_description?: unknown }>)
    : [];
  const failingExamples = examples
    .filter((e) => e.status === 'failed')
    .map((e) => String(e.full_description ?? 'unnamed example'))
    .slice(0, MAX_FAILING_EXAMPLES);

  return {
    result: summary.failure_count > 0 ? 'fail' : 'pass',
    exampleCount: summary.example_count,
    failureCount: summary.failure_count,
    pendingCount: typeof summary.pending_count === 'number' ? summary.pending_count : null,
    failingExamples,
    durationSeconds: typeof summary.duration === 'number' ? summary.duration : null,
    errorReason: null,
  };
}
