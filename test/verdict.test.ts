import { describe, expect, it } from 'vitest';
import { enforceCitationRule, type Verdict } from '../src/mastra/agents/verdict';

const base: Verdict = {
  verdict: 'MERGE',
  riskClass: 'low',
  dependency: 'rack',
  fromVersion: '2.2.8',
  toVersion: '2.2.10',
  citation: { version: '2.2.9', quote: 'Fixed a header parsing bug.' },
  reasoning: 'Fixes only.',
  prUrl: 'https://github.com/dgalarza/creatorsignal/pull/42',
};

describe('enforceCitationRule', () => {
  it('passes cited MERGE/HOLD verdicts through untouched', () => {
    expect(enforceCitationRule(base)).toBe(base);
    const hold = { ...base, verdict: 'HOLD' as const, riskClass: 'moderate' as const };
    expect(enforceCitationRule(hold)).toBe(hold);
  });

  it('downgrades an uncited MERGE to NEEDS_REVIEW and raises the floor on risk', () => {
    const result = enforceCitationRule({ ...base, citation: null });
    expect(result.verdict).toBe('NEEDS_REVIEW');
    expect(result.riskClass).toBe('moderate');
    expect(result.reasoning).toContain('Downgraded from MERGE');
  });

  it('downgrades an uncited HOLD without lowering its risk class', () => {
    const result = enforceCitationRule({ ...base, verdict: 'HOLD', riskClass: 'high', citation: null });
    expect(result.verdict).toBe('NEEDS_REVIEW');
    expect(result.riskClass).toBe('high');
  });

  it('allows NEEDS_REVIEW without a citation', () => {
    const nr = { ...base, verdict: 'NEEDS_REVIEW' as const, citation: null };
    expect(enforceCitationRule(nr)).toBe(nr);
  });

  it('keeps the downgrade reasoning card-sized', () => {
    const result = enforceCitationRule({ ...base, citation: null });
    expect(result.reasoning.length).toBeLessThanOrEqual(280);
  });
});
