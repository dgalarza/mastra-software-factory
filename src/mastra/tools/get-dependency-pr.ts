import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getGithubClient, splitRepo } from '../../lib/github';
import { parseDependabotPr } from '../../lib/dependabot';

const MAX_FILES = 50;
const MAX_BODY_CHARS = 4_000;

export const getDependencyPr = createTool({
  id: 'get-dependency-pr',
  description:
    'Fetch a Dependabot pull request and parse which dependency it bumps, from which version to which, plus the changed files. Grouped multi-dependency PRs are flagged rather than unpacked.',
  inputSchema: z.object({
    repo: z.string().describe('Repository full name, e.g. "dgalarza/creatorsignal"'),
    prNumber: z.number().int().describe('Pull request number'),
  }),
  outputSchema: z.object({
    recognized: z.boolean().describe('False when the PR does not follow Dependabot conventions'),
    grouped: z.boolean().describe('True for grouped multi-dependency updates'),
    dependency: z.string().nullable(),
    ecosystem: z.string().nullable().describe('Package ecosystem, e.g. "bundler"'),
    fromVersion: z.string().nullable(),
    toVersion: z.string().nullable(),
    prUrl: z.string(),
    prBody: z.string().describe('PR description (truncated) — Dependabot embeds release-note excerpts here, often cut off'),
    files: z.array(
      z.object({
        path: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    ),
  }),
  execute: async ({ repo, prNumber }, { observe }) => {
    const github = getGithubClient();
    const { owner, repo: name } = splitRepo(repo);

    observe.log('info', 'fetching dependency PR', { repo, prNumber });
    const [{ data: pr }, { data: files }] = await Promise.all([
      github.rest.pulls.get({ owner, repo: name, pull_number: prNumber }),
      github.rest.pulls.listFiles({ owner, repo: name, pull_number: prNumber, per_page: MAX_FILES }),
    ]);

    const parsed = parseDependabotPr(pr.title, pr.head.ref);

    let prBody = pr.body ?? '';
    if (prBody.length > MAX_BODY_CHARS) {
      prBody = `${prBody.slice(0, MAX_BODY_CHARS)}\n…[truncated]`;
    }

    return {
      recognized: parsed.recognized,
      grouped: parsed.grouped,
      dependency: parsed.dependency,
      ecosystem: parsed.ecosystem,
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      prUrl: pr.html_url,
      prBody,
      files: files.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })),
    };
  },
});
