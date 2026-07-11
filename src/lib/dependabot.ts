/**
 * Parse Dependabot PR conventions.
 *
 * Dependabot encodes what it bumped in two places:
 *  - PR title: `Bump <dep> from <a> to <b>` (grouped updates use
 *    `Bump the <name> group ... with N updates`)
 *  - Branch:   `dependabot/<ecosystem>/<optional dir/><dep>-<version>`
 *
 * Grouped PRs bump several dependencies at once; Episode 1 classifies those
 * as NEEDS-REVIEW rather than triaging each member, to keep the demo scope
 * tight.
 */

export interface DependabotPr {
  /** False when the title doesn't match any Dependabot convention. */
  recognized: boolean;
  /** True for grouped multi-dependency updates. */
  grouped: boolean;
  dependency: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  /** Package ecosystem from the branch name, e.g. "bundler", "npm_and_yarn". */
  ecosystem: string | null;
  /** Directory prefix for monorepo updates, e.g. "app" — null at repo root. */
  directory: string | null;
}

// Repos that set a commit-message prefix get titles like
// "chore(deps): bump rack from 2.2.8 to 2.2.10" — allow one leading
// conventional-commit prefix. Versions can be requirement ranges with
// spaces ("~> 6.0"), so match lazily up to the final " to ".
const PREFIX = /^(?:[a-z]+(?:\([^)]*\))?!?:\s+)?/i;
const SINGLE_BUMP = new RegExp(
  PREFIX.source + /(?:Bump|Update|Upgrade)\s+(\S+)\s+(?:requirement\s+)?from\s+(.+?)\s+to\s+(.+?)(?:\s+in\s+\S+)?$/.source,
  'i',
);
const GROUPED_BUMP = new RegExp(PREFIX.source + /(?:Bump|Update|Upgrade) the (\S+) group\b/.source, 'i');

export function parseDependabotTitle(title: string): Pick<DependabotPr, 'recognized' | 'grouped' | 'dependency' | 'fromVersion' | 'toVersion'> {
  const grouped = GROUPED_BUMP.exec(title);
  if (grouped) {
    return { recognized: true, grouped: true, dependency: grouped[1], fromVersion: null, toVersion: null };
  }
  const single = SINGLE_BUMP.exec(title);
  if (single) {
    return {
      recognized: true,
      grouped: false,
      dependency: single[1],
      fromVersion: single[2],
      toVersion: single[3],
    };
  }
  return { recognized: false, grouped: false, dependency: null, fromVersion: null, toVersion: null };
}

export function parseDependabotBranch(branch: string): Pick<DependabotPr, 'ecosystem' | 'directory'> {
  // dependabot/bundler/rack-2.2.10
  // dependabot/npm_and_yarn/app/left-pad-1.3.0
  const parts = branch.split('/');
  if (parts[0] !== 'dependabot' || parts.length < 3) {
    return { ecosystem: null, directory: null };
  }
  const ecosystem = parts[1];
  // GitHub Actions dependency names contain slashes themselves
  // (dependabot/github_actions/actions/checkout-4 bumps "actions/checkout"),
  // so middle segments are the dependency, not a directory.
  const directory = ecosystem !== 'github_actions' && parts.length > 3 ? parts.slice(2, -1).join('/') : null;
  return { ecosystem, directory };
}

export function parseDependabotPr(title: string, branch: string): DependabotPr {
  return { ...parseDependabotTitle(title), ...parseDependabotBranch(branch) };
}
