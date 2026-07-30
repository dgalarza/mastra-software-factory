import { registerApiRoute } from '@mastra/core/server';
import { Sandbox } from 'railway';
import { RailwaySandbox } from '@mastra/railway';

/**
 * Does @mastra/railway honor a PRE-BUILT SandboxTemplate?
 *
 *   curl -X POST http://localhost:4111/dev/template-probe
 *
 * Standalone tsx scripts said no: raw `Sandbox.create(built)` produced a
 * populated sandbox while `new RailwaySandbox({ template: built })` produced
 * a bare one, silently. But a script is not production — the dev server runs
 * `.mastra/output/index.mjs`, a bundle whose module graph differs from
 * whatever tsx hands a loose script, and module identity is exactly the sort
 * of thing that changes between the two. So the finding has to be re-taken
 * HERE, inside the bundle, before it means anything.
 *
 * Builds one credential-free template with two checkable effects, then
 * creates from it three ways and reports what each sandbox actually
 * contains. Dev-only: never registered in production.
 */
export const devTemplateProbeRoute = registerApiRoute('/dev/template-probe', {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    const logger = c.get('mastra').getLogger();
    const cfg = {
      token: process.env.RAILWAY_API_TOKEN!,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID!,
    };
    if (!cfg.token || !cfg.environmentId) {
      return c.json({ error: 'Railway credentials not configured' }, 503);
    }

    const CHECK = 'cat /probe-marker.txt 2>&1 | head -1; ls -d /probe-dir 2>&1 | head -1';
    const recipe = (t: ReturnType<typeof Sandbox.template>) =>
      t.run('echo IN-SERVER-MARKER > /probe-marker.txt').run('mkdir -p /probe-dir');

    const results: Record<string, unknown> = {};
    // Is the SDK the dev-server bundle sees the same module instance the
    // route sees? If Mastra's copy differs, template identity cannot survive
    // the boundary and that alone explains the script-level finding.
    results.moduleIdentity = {
      sandboxClassName: Sandbox.name,
      templateCtor: Object.getPrototypeOf(Sandbox.template())?.constructor?.name ?? null,
    };

    try {
      const built = await recipe(Sandbox.template()).build(cfg);
      results.built = true;

      // A — raw SDK, the known-good control.
      const a = await Sandbox.create(built, { ...cfg, idleTimeoutMinutes: 5 });
      const ra = await a.exec(`bash -lc '${CHECK}'`, { timeoutSec: 60 });
      results.rawSdk = { sandboxId: a.id, output: (ra.stdout + ra.stderr).trim() };
      await a.destroy();

      // B — Mastra, handed the SAME built object.
      const b = new RailwaySandbox({ id: 'tpl-probe-obj', template: built, idleTimeoutMinutes: 5 });
      await b.start();
      const rb = await b.executeCommand('bash', ['-lc', CHECK], { timeout: 60_000 });
      results.mastraPrebuilt = { sandboxId: b.railway.id, output: (rb.stdout + rb.stderr).trim() };
      await b.destroy();

      // C — Mastra, callback form (what the factory uses today).
      const d = new RailwaySandbox({ id: 'tpl-probe-cb', template: (t) => recipe(t), idleTimeoutMinutes: 5 });
      await d.start();
      const rd = await d.executeCommand('bash', ['-lc', CHECK], { timeout: 60_000 });
      results.mastraCallback = { sandboxId: d.railway.id, output: (rd.stdout + rd.stderr).trim() };
      await d.destroy();

      const populated = (v: unknown) => typeof v === 'string' && v.includes('IN-SERVER-MARKER');
      results.verdict = {
        rawSdkWorks: populated((results.rawSdk as any)?.output),
        prebuiltWorks: populated((results.mastraPrebuilt as any)?.output),
        callbackWorks: populated((results.mastraCallback as any)?.output),
      };
      return c.json(results, 200);
    } catch (err) {
      logger?.error('template probe failed', { error: err instanceof Error ? err.message : String(err) });
      results.error = err instanceof Error ? err.message : String(err);
      return c.json(results, 500);
    }
  },
});
