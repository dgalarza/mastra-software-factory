/**
 * Queue audit: list the open Dependabot PRs on a repo with parsed
 * dependency/version fields — the hunting ground for HOLD candidates.
 *
 *   pnpm audit-queue owner/repo
 */
import { getGithubClient, splitRepo } from '../src/lib/github';
import { parseDependabotPr } from '../src/lib/dependabot';

const repoArg = process.argv[2];
if (!repoArg) {
  console.error('Usage: pnpm audit-queue <owner/repo>');
  process.exit(1);
}

const github = getGithubClient();
const { owner, repo } = splitRepo(repoArg);

const prs = await github.paginate(github.rest.pulls.list, {
  owner,
  repo,
  state: 'open',
  per_page: 100,
});

const dependabot = prs.filter((pr) => pr.user?.login === 'dependabot[bot]');
if (dependabot.length === 0) {
  console.log(`No open Dependabot PRs on ${repoArg}.`);
  process.exit(0);
}

console.log(`Open Dependabot PRs on ${repoArg}:\n`);
for (const pr of dependabot) {
  const parsed = parseDependabotPr(pr.title, pr.head.ref);
  const bump = parsed.grouped
    ? `grouped: ${parsed.dependency}`
    : `${parsed.dependency} ${parsed.fromVersion} → ${parsed.toVersion}`;
  console.log(`  #${String(pr.number).padEnd(5)} ${(parsed.ecosystem ?? '?').padEnd(14)} ${bump}`);
}
console.log(`\n${dependabot.length} PR(s). Run the triage loop against each, or hunt HOLD candidates manually.`);
