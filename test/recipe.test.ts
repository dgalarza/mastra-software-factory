import { describe, expect, it } from 'vitest';
import {
  BUILD_STEPS,
  PROBE_ARTIFACT_PATH,
  RSPEC_ARTIFACT_PATH,
  WARMUP_STEPS,
} from '../src/lib/sandbox/recipe';

const ALL_STEPS = [...BUILD_STEPS, ...WARMUP_STEPS];

describe('sandbox recipe', () => {
  /**
   * Credential hygiene: a token embedded in a clone URL persists in
   * .git/config and would be baked into the shared image, so the recipe must
   * authenticate exclusively through the env-reading credential helper.
   */
  it('never embeds credentials in URLs (userinfo would persist in .git/config)', () => {
    for (const step of ALL_STEPS) {
      expect(step).not.toMatch(/https?:\/\/[^/\s]*@/);
    }
  });

  it('references GITHUB_TOKEN only as an env var, never a literal', () => {
    const material = ALL_STEPS.join('\n');
    // The helper script reads $GITHUB_TOKEN at invocation; nothing that
    // looks like an actual GitHub token may appear in the recipe itself.
    expect(material).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
    expect(material).not.toMatch(/github_pat_[A-Za-z0-9_]{20,}/);
  });

  it('bakes the gem install into the template, not a warmup phase', () => {
    // ADR 004: template.build() has no 120s gateway limit, so the heavy
    // steps belong in the image. If this ever moves back out, sandboxes stop
    // starting warm and every audit pays a full bundle install.
    expect([...BUILD_STEPS, ...WARMUP_STEPS].join('\n')).toContain('bundle install');
  });

  it('scrubs evidence artifacts so the built image is pristine', () => {
    // A base carrying a previous audit's /tmp/probes.jsonl let PR #52 report
    // PR #38's findings as its own. The image must never contain either.
    const steps = [...BUILD_STEPS, ...WARMUP_STEPS].join('\n');
    expect(steps).toContain(RSPEC_ARTIFACT_PATH);
    expect(steps).toContain(PROBE_ARTIFACT_PATH);
  });

  it('stops Postgres cleanly in every step that starts it', () => {
    // A checkpoint captured with a running-state pidfile blocks the next
    // boot; every start/stop cycle must end stopped with the pidfile gone.
    // (The pg-up install step CONTAINS start commands but doesn't run them.)
    const startsPostgres = BUILD_STEPS.filter(
      (s) => s.includes('pg_ctl') && s.includes('start') && !s.includes('/usr/local/bin/pg-up'),
    );
    expect(startsPostgres.length).toBeGreaterThan(0);
    for (const step of startsPostgres) {
      expect(step).toContain('stop -m fast -w');
      expect(step).toContain('rm -f /var/lib/postgresql/17/main/postmaster.pid');
    }
    // Warmup starts Postgres via pg-up; its final step must stop it so a
    // capture taken right after warmup is clean.
    const lastWarmup = WARMUP_STEPS[WARMUP_STEPS.length - 1];
    expect(lastWarmup).toContain('stop -m fast -w');
    expect(lastWarmup).toContain('rm -f /var/lib/postgresql/17/main/postmaster.pid');
  });

  it('keeps the template light enough to boot within the create gateway timeout', () => {
    // Template boots carrying the gem bundle 504 at Railway's ~120s create
    // gateway limit (ADR 004) — the heavy steps must stay in WARMUP_STEPS.
    for (const step of BUILD_STEPS) {
      expect(step).not.toContain('bundle install');
      expect(step).not.toContain('db:prepare');
    }
  });
});
