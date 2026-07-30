import { Workspace } from '@mastra/core/workspace';
import { RailwaySandbox } from '@mastra/railway';
import type { SandboxTemplate } from 'railway';
import { APT_PACKAGES, BUILD_STEPS, GITHUB_TOKEN_PATH, WARMUP_STEPS, buildTimeToken } from '../lib/sandbox/recipe';
import { mintInstallationToken } from '../lib/github';

/**
 * Per-triage sandboxes, forked from one pre-built Railway template.
 *
 * Dependabot opens PRs in bursts — weft has eleven open — so the realistic
 * load is N audits at once, each needing its own machine. A shared sandbox
 * cannot do that: concurrent triages would overwrite each other's /tmp
 * evidence artifacts and cross-contaminate their verdicts.
 *
 *   built template (Ruby, Postgres, weft clone, gems, test schema)
 *      ├── PR #38 → sandbox A → audit → destroy
 *      ├── PR #52 → sandbox B → audit → destroy      concurrent, isolated
 *      └── PR #56 → sandbox C → audit → destroy
 *
 * Crucially, NO sandbox here carries a `checkpointName`. That is not a
 * detail — @mastra/railway arms a refresh timer whenever one is set and
 * captures live disk state ~10s before idle teardown, which silently
 * rewrites the shared base with whatever the last audit left behind. That
 * is not theoretical: it happened, and PR #52 restored PR #38's
 * /tmp/probes.jsonl and reported "7/7 assertions verified" it had never
 * run. With templates there is no mutable base to poison at all — Railway
 * content-addresses the build, so the image is immutable by construction
 * rather than defended by scrub steps. See ADR 004.
 *
 * ISOLATED networking is deliberate and on-camera: outbound internet only.
 * These sandboxes cannot reach the weft service deployed in the same
 * Railway environment — do not "upgrade" this to PRIVATE.
 */

/** Destroyed explicitly after every audit; this is only a leak backstop. */
const IDLE_TIMEOUT_MINUTES = 10;

/**
 * Concurrency ceiling. The plan allows far more (50+ on Hobby), but each
 * live sandbox bills CPU and memory while a full model conversation runs
 * beside it. A burst of eleven PRs should queue, not stampede.
 */
const MAX_CONCURRENT_SANDBOXES = 4;

let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT_SANDBOXES) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function releaseSlot(): void {
  active -= 1;
  waiting.shift()?.();
}

export function sandboxConfigured(): boolean {
  const hasRailway = !!process.env.RAILWAY_API_TOKEN && !!process.env.RAILWAY_ENVIRONMENT_ID;
  const hasGithub =
    !!process.env.GITHUB_TOKEN ||
    (!!process.env.GITHUB_APP_ID && !!process.env.GITHUB_PRIVATE_KEY && !!process.env.GITHUB_INSTALLATION_ID);
  return hasRailway && hasGithub;
}

function clientConfig() {
  return {
    token: process.env.RAILWAY_API_TOKEN!,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID!,
  };
}

/**
 * The audit base image, expressed as a template builder callback.
 *
 * Railway builds these ordered steps once, content-addresses the result, and
 * caches it; creating a sandbox forks the cached build in ~3s. Both
 * BUILD_STEPS and WARMUP_STEPS are included, gem install and all: building
 * heavy steps DURING `create` 504s at Railway's 120s gateway, but
 * `pnpm build-template` builds the identical content out-of-band, so this
 * resolves to a cache hit rather than a build. See ADR 004.
 *
 * The callback form is deliberate: @mastra/railway silently ignores a
 * pre-built `SandboxTemplate` object passed as `template` and provisions a
 * bare sandbox instead — verified by building one recipe and creating from
 * it both ways (raw SDK: populated; Mastra with the object: empty; Mastra
 * with this callback: populated). Do not "simplify" this to pass a built
 * template; the failure is silent and looks like a broken recipe.
 */
export function auditTemplate(t: SandboxTemplate): SandboxTemplate {
  // Step order is part of the template's content hash, so the reduce must
  // stay ordered — BUILD_STEPS then WARMUP_STEPS. Reordering silently
  // produces a different image and a fresh ~60s build.
  return [...BUILD_STEPS, ...WARMUP_STEPS].reduce(
    (template, step) => template.run(step),
    t.withEnv({ GITHUB_TOKEN: buildTimeToken() }).withPackages(...APT_PACKAGES),
  );
}

export interface AuditSandbox {
  workspace: Workspace;
  sandbox: RailwaySandbox;
  /** Idempotent: releases the concurrency slot and destroys the sandbox. */
  release: () => Promise<void>;
}

/**
 * Fork one sandbox from the built template for a single triage.
 *
 * Returns undefined when Railway or GitHub credentials are absent — the
 * factory then triages read-only exactly as it did in Episode 1, and
 * enforceEvidenceRule blocks MERGE for want of a verifiable run.
 */
export async function acquireAuditSandbox(runId: string): Promise<AuditSandbox | undefined> {
  if (!sandboxConfigured()) return undefined;

  await acquireSlot();
  try {
    const sandbox = new RailwaySandbox({
      id: `audit-${runId}`,
      // No checkpointName — see the module docblock. This is what makes the
      // base immutable rather than merely guarded.
      template: auditTemplate,
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
      networkIsolation: 'ISOLATED',
      ...(process.env.GITHUB_TOKEN ? { env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN } } : {}),
    });
    const workspace = new Workspace({ sandbox });
    await workspace.init();

    let released = false;
    return {
      workspace,
      sandbox,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await workspace.destroy();
        } finally {
          releaseSlot();
        }
      },
    };
  } catch (err) {
    releaseSlot();
    throw err;
  }
}

/**
 * Write a fresh clone credential onto this sandbox's tmpfs.
 *
 * Installation tokens expire in ~1 hour, so one is minted per triage
 * rather than baked at build time. The write goes through the documented
 * `.railway` escape hatch so the secret never appears in a command line,
 * and lands on /dev/shm so it exists only in memory.
 */
export async function deliverCloneToken(sandbox: RailwaySandbox): Promise<boolean> {
  const token = await mintInstallationToken();
  if (!token) return false;
  await sandbox.railway.files.write(GITHUB_TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return true;
}
