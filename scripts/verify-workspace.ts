/**
 * Smoke-test the audit base image: forks a sandbox exactly as a triage
 * does, then checks Ruby, Postgres, and the baked weft clone.
 *
 *   pnpm exec tsx --env-file=.env scripts/verify-workspace.ts
 */
import { acquireAuditSandbox } from '../src/mastra/workspace';
import { SHELL_PRELUDE, WEFT_DIR } from '../src/lib/sandbox/recipe';

const t0 = Date.now();
const audit = await acquireAuditSandbox('verify');
if (!audit) {
  console.error('Railway/GitHub credentials missing — nothing to verify.');
  process.exit(1);
}
console.log(`sandbox ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

try {
  const sh = async (label: string, cmd: string) => {
    const r = await audit.sandbox.executeCommand('bash', ['-lc', `${SHELL_PRELUDE} ${cmd}`], { timeout: 120_000 });
    const out = (r.stdout + r.stderr).trim();
    console.log(`${r.exitCode === 0 ? '\u2713' : '\u2717'} ${label} (exit ${r.exitCode}): ${out.split('\n').slice(-2).join(' | ').slice(0, 160)}`);
    if (r.exitCode !== 0) process.exitCode = 1;
  };
  await sh('ruby', 'ruby -v && bundle -v');
  await sh('postgres', 'pg-up');
  await sh('tcp auth (the audit path)', 'PGPASSWORD=weft psql -h localhost -U weft -d postgres -tc "select 1"');
  await sh('baked weft clone + gems', `cd ${WEFT_DIR} && git log --oneline -1 && bundle check`);
  // Absence is the pass condition here: a base carrying a previous audit's
  // artifacts is what let PR #52 report PR #38's findings as its own.
  await sh(
    'pristine (no leftover evidence)',
    'if ls /tmp/rspec.json /tmp/probes.jsonl >/dev/null 2>&1; then echo "STALE EVIDENCE PRESENT"; exit 1; else echo "clean"; fi',
  );
} finally {
  await audit.release();
  console.log('sandbox destroyed');
}
process.exit(process.exitCode ?? 0);
