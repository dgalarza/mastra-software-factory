import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

/**
 * GitHub client for all factory reads.
 *
 * With GitHub App credentials configured, authenticates as the app's
 * installation (JWT → installation access token, auto-refreshed by Octokit).
 * The app is scoped READ-ONLY — Pull requests, Contents, Metadata — so the
 * factory cannot mutate the repo no matter what any prompt says. That
 * guardrail lives at the infrastructure layer, not in instructions.
 *
 * Without credentials, falls back to unauthenticated access: public repos
 * only, 60 requests/hour — enough for local development against fixtures.
 */

let cached: Octokit | null = null;

function normalizePrivateKey(raw: string): string {
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  // Base64-encoded PEM (the friendlier way to store a multi-line key in env)
  return Buffer.from(raw, 'base64').toString('utf8');
}

export function getGithubClient(): Octokit {
  if (cached) return cached;

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
  const installationId = process.env.GITHUB_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    cached = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: Number(appId),
        privateKey: normalizePrivateKey(privateKey),
        installationId: Number(installationId),
      },
    });
  } else if (process.env.GITHUB_TOKEN) {
    // Personal access token — local development against public repos
    cached = new Octokit({ auth: process.env.GITHUB_TOKEN });
  } else {
    cached = new Octokit();
  }
  return cached;
}

/**
 * Mint a short-lived installation access token for the read-only App —
 * the credential the sandbox clones with. Expires in ~1 hour, scoped to
 * the installation's repos, read-only by the App's permissions. Falls back
 * to GITHUB_TOKEN (dev PAT) and then to null, in which case the audit's
 * clone step fails and the evidence rule downgrades honestly.
 */
export async function mintInstallationToken(): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
  const installationId = process.env.GITHUB_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    const auth = createAppAuth({
      appId: Number(appId),
      privateKey: normalizePrivateKey(privateKey),
      installationId: Number(installationId),
    });
    const { token } = await auth({ type: 'installation' });
    return token;
  }
  return process.env.GITHUB_TOKEN ?? null;
}

/** Split "owner/name" — the form webhooks and tools pass around. */
export function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`Invalid repo full name: ${fullName}`);
  return { owner, repo };
}

/**
 * Extract "owner/repo" from a github.com URL (source_code_uri, homepage_uri,
 * changelog_uri all show up in gem metadata). Returns null for non-GitHub URLs.
 */
export function githubRepoFromUrl(url: string | null | undefined): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i.exec(url);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}
