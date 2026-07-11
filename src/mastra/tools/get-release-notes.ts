import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getGithubClient, githubRepoFromUrl } from '../../lib/github';
import { getGemMetadata } from '../../lib/rubygems';
import { inBumpRange, versionFromTag, compareVersions } from '../../lib/versions';

/**
 * The core tool of Station 1: fetch the human-written release notes for
 * EVERY version between the one you're on and the one Dependabot proposes —
 * the reading no one does by hand.
 *
 * Resolution chain (bundler/gems):
 *   1. RubyGems metadata → changelog_uri / source_code_uri / homepage_uri
 *   2. GitHub Releases on the source repo, filtered to versions in (from, to]
 *   3. Raw CHANGELOG.md from the source repo, sliced by version headings
 *   4. Nothing resolvable → { found: false } — the agent must answer
 *      NEEDS-REVIEW, never guess.
 */

const MAX_NOTES_CHARS = 4_000;

interface ReleaseNotes {
  version: string;
  notes: string;
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_NOTES_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_NOTES_CHARS)}\n…[truncated]`;
}

/**
 * Slice a CHANGELOG into per-version sections. Recognizes the common heading
 * shapes: `## 2.2.9`, `## [2.2.9] - 2024-01-01`, `# v2.2.9`, `2.2.9 (date)`.
 *
 * The version must LEAD the heading text — matching it anywhere in the line
 * turns body prose like "Versions 2.2.5 through 2.2.8 are affected" into a
 * bogus section boundary that silently swallows the notes after it.
 */
export function sliceChangelog(changelog: string, fromVersion: string, toVersion: string): ReleaseNotes[] {
  const lines = changelog.split('\n');
  const sections: ReleaseNotes[] = [];
  let current: { version: string; lines: string[] } | null = null;

  const LEADING_VERSION = /^\[?(?:version\s+)?v?(\d+\.\d+(?:\.\d+)*(?:[.-][0-9a-z]+)*)\]?/i;

  const headingVersion = (line: string): string | null => {
    const hash = /^#{1,4}\s+(.*)$/.exec(line);
    const text = hash ? hash[1] : line;
    const match = LEADING_VERSION.exec(text);
    if (!match) return null;
    if (!hash) {
      // A bare line only counts as a heading when nothing but decoration or
      // a date follows the version — "3.2 and 3.1 remain supported" is body.
      const rest = text.slice(match[0].length);
      if (!/^\s*(?:[-–—/(].*)?$/.test(rest)) return null;
    }
    return match[1];
  };

  for (const line of lines) {
    const version = headingVersion(line);
    if (version) {
      if (current) sections.push({ version: current.version, notes: truncate(current.lines.join('\n')) });
      current = { version, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ version: current.version, notes: truncate(current.lines.join('\n')) });

  return sections
    .filter((s) => inBumpRange(s.version, fromVersion, toVersion))
    .filter((s) => s.notes.length > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

async function fetchChangelogFile(owner: string, repo: string): Promise<string | null> {
  const github = getGithubClient();
  for (const path of ['CHANGELOG.md', 'CHANGELOG', 'Changes.md', 'CHANGES.md', 'History.md', 'History.rdoc']) {
    try {
      const res = await github.rest.repos.getContent({
        owner,
        repo,
        path,
        mediaType: { format: 'raw' },
      });
      // With format: 'raw' the response body is the file contents as a
      // string; Octokit's types only model the JSON shapes.
      const data = res.data as unknown;
      if (typeof data === 'string' && data.length > 0) return data;
    } catch (err) {
      // 404 means "try the next conventional filename". Anything else
      // (rate limit, 5xx, network) must surface — swallowing it would
      // launder an infrastructure failure into a confident-looking
      // "no notes found" NEEDS_REVIEW.
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return null;
}

export const getReleaseNotes = createTool({
  id: 'get-release-notes',
  description:
    'Fetch the human-written release notes for every version of a dependency between fromVersion (exclusive) and toVersion (inclusive). Resolves via RubyGems metadata, then GitHub Releases, then the CHANGELOG file. When found is false, no notes could be resolved — do not guess about what changed.',
  inputSchema: z.object({
    dependency: z.string().describe('Dependency name, e.g. "rack"'),
    ecosystem: z.string().describe('Package ecosystem — Station 1 resolves "bundler" (RubyGems) only'),
    fromVersion: z.string().describe('Currently installed version'),
    toVersion: z.string().describe('Version the PR bumps to'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    source: z.enum(['releases', 'changelog', 'none']).describe('Which rung of the resolution chain produced the notes'),
    releases: z.array(
      z.object({
        version: z.string(),
        notes: z.string(),
      }),
    ),
  }),
  execute: async ({ dependency, ecosystem, fromVersion, toVersion }, { observe }) => {
    const notFound = { found: false as const, source: 'none' as const, releases: [] };

    if (ecosystem !== 'bundler') {
      observe.log('warn', 'unsupported ecosystem for release-notes resolution', { ecosystem });
      return notFound;
    }

    // "Update x requirement" PRs carry constraint ranges (">= 6.0, < 7.1"),
    // not versions — there is no meaningful (from, to] range to read, so
    // this is honestly unresolvable rather than approximately guessable.
    const EXACT_VERSION = /^v?\d+(\.\d+)*([.-][0-9a-z]+)*$/i;
    if (!EXACT_VERSION.test(fromVersion) || !EXACT_VERSION.test(toVersion)) {
      observe.log('warn', 'from/to are not exact versions', { fromVersion, toVersion });
      return notFound;
    }

    // 1. Registry metadata — where does this gem say its changelog/source live?
    const gem = await getGemMetadata(dependency);
    if (!gem) {
      observe.log('warn', 'gem not found on RubyGems', { dependency });
      return notFound;
    }

    const sourceRepo =
      githubRepoFromUrl(gem.sourceCodeUri) ??
      githubRepoFromUrl(gem.homepageUri) ??
      githubRepoFromUrl(gem.changelogUri);
    if (!sourceRepo) {
      observe.log('warn', 'no GitHub source resolvable from gem metadata', { dependency });
      return notFound;
    }

    // 2. GitHub Releases — every intermediate version in (from, to].
    // Page cap: some source repos (monorepos, SDKs) have thousands of
    // releases; recent pages cover any realistic bump range, and walking
    // the full history burns the API quota. (No early exit on version
    // order — GitHub sorts by created_at and backports break monotonicity.)
    const MAX_RELEASE_PAGES = 4;
    const github = getGithubClient();
    let pages = 0;
    const releases = await github.paginate(
      github.rest.repos.listReleases,
      { owner: sourceRepo.owner, repo: sourceRepo.repo, per_page: 100 },
      (response, done) => {
        if (++pages >= MAX_RELEASE_PAGES) done();
        return response.data;
      },
    );

    const inRange = releases
      .map((r) => ({ version: versionFromTag(r.tag_name, dependency), body: r.body ?? '' }))
      .filter((r): r is { version: string; body: string } => r.version !== null)
      .filter((r) => inBumpRange(r.version, fromVersion, toVersion))
      .map((r) => ({ version: r.version, notes: truncate(r.body) }))
      .filter((r) => r.notes.length > 0)
      .sort((a, b) => compareVersions(a.version, b.version));

    if (inRange.length > 0) {
      observe.log('info', 'release notes resolved from GitHub Releases', {
        dependency,
        versions: inRange.map((r) => r.version),
      });
      return { found: true, source: 'releases' as const, releases: inRange };
    }

    // 3. CHANGELOG file fallback
    const changelog = await fetchChangelogFile(sourceRepo.owner, sourceRepo.repo);
    if (changelog) {
      const sections = sliceChangelog(changelog, fromVersion, toVersion);
      if (sections.length > 0) {
        observe.log('info', 'release notes resolved from CHANGELOG', {
          dependency,
          versions: sections.map((s) => s.version),
        });
        return { found: true, source: 'changelog' as const, releases: sections };
      }
    }

    // 4. Nothing resolvable
    observe.log('warn', 'no release notes resolvable in range', { dependency, fromVersion, toVersion });
    return notFound;
  },
});
