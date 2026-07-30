/**
 * Build the audit base image ahead of time.
 *
 * Railway content-addresses template builds and caches them, so this pays
 * the ~60s build off-camera. Every sandbox afterwards forks the cached
 * build in ~3s, and because the recipe contains no varying value the cache
 * survives process restarts indefinitely.
 *
 *   pnpm build-template
 *
 * Run it after changing anything in recipe.ts, and before recording —
 * otherwise the first triage of a session pays the build. There is no
 * checkpoint to capture and nothing mutable to keep clean: the built image
 * is immutable, which is the point of ADR 007.
 */
import { Sandbox } from 'railway';
import { auditTemplate, sandboxConfigured } from '../src/mastra/workspace';

if (!sandboxConfigured()) {
  console.error('Railway and GitHub credentials required — nothing to build.');
  process.exit(1);
}

const t0 = Date.now();
// Same content the workspace callback produces, so this warms the exact
// cache entry a triage will look for.
await auditTemplate(Sandbox.template()).build({
  token: process.env.RAILWAY_API_TOKEN!,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID!,
});
const secs = (Date.now() - t0) / 1000;
console.log(`✅ audit template ready in ${secs.toFixed(1)}s ${secs < 5 ? '(cache hit)' : '(fresh build)'}`);
process.exit(0);
