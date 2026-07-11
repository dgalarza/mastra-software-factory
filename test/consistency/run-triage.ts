/**
 * Consistency harness — the record-ready gate for Episode 1.
 *
 * Runs the full triage (agent + tools, real APIs) N times against one PR and
 * asserts every run produces the SAME verdict AND cites the SAME line.
 * Green N/N on the designated HOLD candidate = safe to record. If this is
 * flaky, freeze a different model/prompt — do not record.
 *
 *   pnpm consistency owner/repo prNumber [runs=10]
 */
import { triageAgent, VerdictSchema, enforceCitationRule, type Verdict } from '../../src/mastra/agents/triage';

const [repoArg, prArg, runsArg] = process.argv.slice(2);
if (!repoArg || !prArg) {
  console.error('Usage: pnpm consistency <owner/repo> <prNumber> [runs=10]');
  process.exit(1);
}
const prNumber = Number(prArg);
const runs = runsArg ? Number(runsArg) : 10;

const results: Verdict[] = [];
for (let i = 1; i <= runs; i++) {
  const result = await triageAgent.generate(
    `Triage Dependabot pull request #${prNumber} in ${repoArg}.`,
    { structuredOutput: { schema: VerdictSchema }, maxSteps: 8 },
  );
  // Same rule the workflow applies — an uncited MERGE/HOLD must not be
  // able to look "green" here and post differently in production.
  const verdict = enforceCitationRule(result.object);
  results.push(verdict);
  console.log(
    `run ${String(i).padStart(2)}/${runs}: ${verdict.verdict.padEnd(12)} ` +
      `[${verdict.riskClass}] cite=${verdict.citation ? `${verdict.citation.version}: "${verdict.citation.quote.slice(0, 60)}…"` : 'none'}`,
  );
}

const verdicts = new Set(results.map((r) => r.verdict));
const quotes = new Set(results.map((r) => r.citation?.quote.trim() ?? '<none>'));

console.log('\n—— consistency ——');
console.log(`verdicts: ${[...verdicts].join(', ')}`);
console.log(`distinct cited lines: ${quotes.size}`);

if (verdicts.size === 1 && quotes.size === 1) {
  console.log(`\n✅ GREEN ${runs}/${runs} — same verdict, same cited line. Safe to record.`);
} else {
  console.error(`\n❌ INCONSISTENT — ${verdicts.size} verdict(s), ${quotes.size} distinct citation(s). Not record-ready.`);
  process.exit(1);
}
