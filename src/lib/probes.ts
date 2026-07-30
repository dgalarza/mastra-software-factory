/**
 * Mutation-probe results — the second half of Station 2's executed evidence.
 *
 * After upgrading a test, assertion, matcher, or mocking library, a green
 * suite is ambiguous: it means either "everything still works" or "the
 * assertions silently stopped asserting", and CI cannot tell those apart.
 * A probe disambiguates it by breaking what an assertion checks and
 * confirming the spec goes red.
 *
 * Records are authored by the `probe-assertion` helper baked into the
 * sandbox image, never by the agent — the same trust property the rspec
 * artifact has.
 *
 * THREE states, not two. A probe that failed to run (bad mutation, no
 * parseable report) must never be reported as an assertion that failed to
 * detect — that conflation produced a false alarm on PR #38 claiming 5 of
 * 7 assertions were decorative when 4 were tooling failures. "We could not
 * tell" and "the test is lying to you" are different claims and only the
 * second is a finding.
 */

export type ProbeStatus = 'detected' | 'missed' | 'errored';

export interface ProbeRecord {
  /** Source file that was mutated. */
  source: string;
  /** Spec expected to detect the mutation. */
  spec: string;
  status: ProbeStatus;
  exitCode: number;
  failureCount: number;
  /** Human-readable reason, chiefly for errored probes. */
  note: string;
}

export interface ProbeSummary {
  ran: boolean;
  /** Conclusive probes only — errored ones prove nothing either way. */
  total: number;
  detected: number;
  /** Assertions that stayed green while their subject was broken. */
  missed: ProbeRecord[];
  /** Probes that could not be completed. Inconclusive, never a finding. */
  errored: ProbeRecord[];
}

export const NO_PROBES: ProbeSummary = { ran: false, total: 0, detected: 0, missed: [], errored: [] };

/**
 * Parse the JSONL probe artifact. Never throws — a malformed line is
 * skipped, and an absent artifact simply means no probes ran (legitimate:
 * most bumps never touch the test tooling).
 */
export function parseProbeArtifact(raw: string): ProbeSummary {
  const records: ProbeRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const r = JSON.parse(trimmed) as Partial<ProbeRecord>;
      if (typeof r.source !== 'string' || typeof r.spec !== 'string') continue;
      const status: ProbeStatus =
        r.status === 'detected' || r.status === 'missed' || r.status === 'errored' ? r.status : 'errored';
      records.push({
        source: r.source,
        spec: r.spec,
        status,
        exitCode: typeof r.exitCode === 'number' ? r.exitCode : -1,
        failureCount: typeof r.failureCount === 'number' ? r.failureCount : -1,
        note: typeof r.note === 'string' ? r.note : '',
      });
    } catch {
      // skip unparseable line
    }
  }
  if (records.length === 0) return NO_PROBES;

  const missed = records.filter((r) => r.status === 'missed');
  const errored = records.filter((r) => r.status === 'errored');
  const detected = records.filter((r) => r.status === 'detected').length;
  return { ran: true, total: detected + missed.length, detected, missed, errored };
}
