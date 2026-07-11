/**
 * RubyGems registry metadata client. The registry is the entry point of the
 * release-notes resolution chain: gems declare where their changelog and
 * source live via `changelog_uri` / `source_code_uri`.
 */

export interface GemMetadata {
  name: string;
  version: string;
  changelogUri: string | null;
  sourceCodeUri: string | null;
  homepageUri: string | null;
}

export async function getGemMetadata(name: string): Promise<GemMetadata | null> {
  const res = await fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`RubyGems API error for ${name}: HTTP ${res.status}`);

  const data = (await res.json()) as {
    name: string;
    version: string;
    changelog_uri: string | null;
    source_code_uri: string | null;
    homepage_uri: string | null;
  };
  return {
    name: data.name,
    version: data.version,
    changelogUri: data.changelog_uri ?? null,
    sourceCodeUri: data.source_code_uri ?? null,
    homepageUri: data.homepage_uri ?? null,
  };
}
