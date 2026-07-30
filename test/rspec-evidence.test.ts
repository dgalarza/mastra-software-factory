import { describe, expect, it } from 'vitest';
import { parseRspecArtifact, verificationError } from '../src/lib/rspec';
import { enforceEvidenceRule, enforceProbeRule, type Verdict } from '../src/mastra/agents/verdict';
import { parseProbeArtifact } from '../src/lib/probes';
import { renderTriageCard } from '../src/lib/slack';

const green = JSON.stringify({
  examples: [{ status: 'passed', full_description: 'Subscriber is valid' }],
  summary: { example_count: 145, failure_count: 0, pending_count: 1, duration: 3.74 },
});

const red = JSON.stringify({
  examples: [
    { status: 'passed', full_description: 'Subscriber is valid' },
    { status: 'failed', full_description: 'Edition delivery enqueues exactly one send' },
  ],
  summary: { example_count: 146, failure_count: 1, pending_count: 1, duration: 4.1 },
});

const mergeVerdict: Verdict = {
  verdict: 'MERGE',
  riskClass: 'low',
  dependency: 'rack',
  fromVersion: '2.2.8',
  toVersion: '2.2.10',
  citation: { version: '2.2.10', quote: 'Fixed a memory leak in the request parser.' },
  reasoning: 'Fixes only.',
  prUrl: 'https://github.com/dgalarza/weft/pull/42',
};

describe('parseRspecArtifact', () => {
  it('reads a green run', () => {
    const v = parseRspecArtifact(green);
    expect(v.result).toBe('pass');
    expect(v.exampleCount).toBe(145);
    expect(v.failureCount).toBe(0);
    expect(v.durationSeconds).toBeCloseTo(3.74);
  });

  it('reads a red run with the failing example names', () => {
    const v = parseRspecArtifact(red);
    expect(v.result).toBe('fail');
    expect(v.failingExamples).toEqual(['Edition delivery enqueues exactly one send']);
  });

  it('treats unparseable output as error, never pass', () => {
    expect(parseRspecArtifact('boom').result).toBe('error');
    expect(parseRspecArtifact('{}').result).toBe('error');
  });

  it('treats a zero-example run as error — weft is never legitimately empty', () => {
    const empty = JSON.stringify({ examples: [], summary: { example_count: 0, failure_count: 0 } });
    expect(parseRspecArtifact(empty).result).toBe('error');
  });
});

describe('enforceEvidenceRule', () => {
  it('lets a MERGE stand on a green run', () => {
    expect(enforceEvidenceRule(mergeVerdict, parseRspecArtifact(green))).toBe(mergeVerdict);
  });

  it('downgrades MERGE to HOLD on a red run, citing the failing example', () => {
    const v = enforceEvidenceRule(mergeVerdict, parseRspecArtifact(red));
    expect(v.verdict).toBe('HOLD');
    expect(v.riskClass).toBe('moderate');
    expect(v.reasoning).toContain('Edition delivery');
  });

  it('downgrades MERGE to NEEDS_REVIEW when the run cannot be proven', () => {
    const v = enforceEvidenceRule(mergeVerdict, verificationError('rspec artifact not found in sandbox'));
    expect(v.verdict).toBe('NEEDS_REVIEW');
    expect(v.reasoning).toContain('no verifiable test run');
  });

  it('leaves HOLD alone even on a green run — notes outrank the suite', () => {
    const hold: Verdict = { ...mergeVerdict, verdict: 'HOLD', riskClass: 'moderate' };
    expect(enforceEvidenceRule(hold, parseRspecArtifact(green))).toBe(hold);
  });
});

describe('verification on the card', () => {
  const base = { ...mergeVerdict, citation: mergeVerdict.citation };

  it('renders a green test line', () => {
    const { card } = renderTriageCard({
      ...base,
      verification: { result: 'pass', exampleCount: 145, failureCount: 0, pendingCount: 1, durationSeconds: 38.5, failingExamples: [], errorReason: null },
    });
    expect(JSON.stringify(card)).toContain('145 examples passed');
  });

  it('renders an unverified line on error, and escapes it', () => {
    const { card } = renderTriageCard({
      ...base,
      verification: { result: 'error', exampleCount: null, failureCount: null, pendingCount: null, durationSeconds: null, failingExamples: [], errorReason: 'artifact <missing>' },
    });
    const s = JSON.stringify(card);
    expect(s).toContain('not verified');
    expect(s).toContain('&lt;missing&gt;');
  });
});

describe('probe evidence', () => {
  const rec = (o: Record<string, unknown>) =>
    JSON.stringify({ source: 'app/models/user.rb', spec: 'spec/models/user_spec.rb', exitCode: 1, failureCount: 1, note: '', ...o });
  const detected = rec({ status: 'detected' });
  const missed = rec({ status: 'missed', spec: 'spec/models/post_spec.rb', exitCode: 0, failureCount: 0 });
  const errored = rec({ status: 'errored', exitCode: -1, failureCount: -1, note: 'no parseable rspec report' });

  it('summarises probes that all detected their mutation', () => {
    const s = parseProbeArtifact([detected, detected].join('\n'));
    expect(s).toMatchObject({ ran: true, total: 2, detected: 2 });
    expect(s.missed).toHaveLength(0);
  });

  it('flags a spec that stayed green while its subject was broken', () => {
    const s = parseProbeArtifact([detected, missed].join('\n'));
    expect(s.total).toBe(2);
    expect(s.missed.map((r) => r.spec)).toEqual(['spec/models/post_spec.rb']);
  });

  it('never counts an errored probe as a failed assertion', () => {
    // The PR #38 false alarm: 4 tooling failures were reported as decorative
    // assertions. Errored probes are inconclusive and excluded from total.
    const s = parseProbeArtifact([detected, errored, errored].join('\n'));
    expect(s.total).toBe(1);
    expect(s.detected).toBe(1);
    expect(s.missed).toHaveLength(0);
    expect(s.errored).toHaveLength(2);
  });

  it('treats an absent or unparseable artifact as no probes, not a failure', () => {
    expect(parseProbeArtifact('').ran).toBe(false);
    expect(parseProbeArtifact('not json\n{oops').ran).toBe(false);
  });

  it('forces HOLD only when an assertion genuinely missed', () => {
    const v = enforceProbeRule(mergeVerdict, parseProbeArtifact([detected, missed].join('\n')));
    expect(v.verdict).toBe('HOLD');
    expect(v.riskClass).toBe('high');
    expect(v.reasoning).toContain('post_spec');
  });

  it('does not downgrade on errored probes alone', () => {
    expect(enforceProbeRule(mergeVerdict, parseProbeArtifact([detected, errored].join('\n')))).toBe(mergeVerdict);
    expect(enforceProbeRule(mergeVerdict, parseProbeArtifact(''))).toBe(mergeVerdict);
  });

  it('renders the assertion count, and reports inconclusive probes honestly', () => {
    const clean = renderTriageCard({ ...mergeVerdict, probes: parseProbeArtifact([detected, detected].join('\n')) });
    expect(JSON.stringify(clean.card)).toContain('2/2 still fail');
    const mixed = renderTriageCard({ ...mergeVerdict, probes: parseProbeArtifact([detected, errored].join('\n')) });
    expect(JSON.stringify(mixed.card)).toContain('1 inconclusive');
  });
});
