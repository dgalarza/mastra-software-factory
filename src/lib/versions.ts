/**
 * RubyGems-style version comparison, approximating Gem::Version semantics:
 * versions split into numeric and alphabetic segments ("7.0.0.beta1" →
 * [7, 0, 0, "beta", 1]); numeric segments compare numerically, alphabetic
 * segments sort before any number (so 7.0.0.beta1 < 7.0.0).
 */

type Segment = number | string;

function segments(version: string): Segment[] {
  const normalized = version.trim().replace(/^v/i, '');
  const parts = normalized.match(/\d+|[a-z]+/gi) ?? [];
  return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p.toLowerCase()));
}

/** Returns <0, 0, >0 like a comparator. */
export function compareVersions(a: string, b: string): number {
  const sa = segments(a);
  const sb = segments(b);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const x = sa[i] ?? 0; // missing segments count as 0: 2.2 == 2.2.0
    const y = sb[i] ?? 0;
    if (x === y) continue;
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && yNum) return (x as number) - (y as number);
    // Strings sort before numbers: "beta" < 0, so 7.0.0.beta1 < 7.0.0
    if (xNum !== yNum) return xNum ? 1 : -1;
    return (x as string) < (y as string) ? -1 : 1;
  }
  return 0;
}

/** True when `version` is in the half-open range (from, to]. */
export function inBumpRange(version: string, fromVersion: string, toVersion: string): boolean {
  return compareVersions(version, fromVersion) > 0 && compareVersions(version, toVersion) <= 0;
}

/**
 * Extract a version from a release tag name. Handles the common shapes:
 * `v2.2.9`, `2.2.9`, and `<gem>-2.2.9`. Returns null when the tag doesn't
 * look like a version for this dependency.
 */
export function versionFromTag(tag: string, dependency: string): string | null {
  let candidate = tag.trim();
  const prefix = `${dependency.toLowerCase()}-`;
  if (candidate.toLowerCase().startsWith(prefix)) candidate = candidate.slice(prefix.length);
  candidate = candidate.replace(/^v/i, '');
  return /^\d/.test(candidate) ? candidate : null;
}
