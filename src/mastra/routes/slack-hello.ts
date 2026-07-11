import { registerApiRoute } from '@mastra/core/server';
import { postToSlack, renderHelloCard } from '../../lib/slack';

/**
 * Manual end-to-end check for the Slack output surface:
 *
 *   curl -X POST http://localhost:4111/dev/slack/hello
 *
 * lands the hello-world card in the factory channel. Dev-only plumbing —
 * the real triage loop posts cards from the workflow, not from here.
 */
export const slackHelloRoute = registerApiRoute('/dev/slack/hello', {
  method: 'POST',
  requiresAuth: false,
  handler: async (c) => {
    const logger = c.get('mastra').getLogger();
    try {
      const result = await postToSlack(renderHelloCard());
      logger?.info('Hello card delivered to Slack', result);
      return c.json({ delivered: true, ...result }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.error('Hello card delivery failed', { error: message });
      return c.json({ delivered: false, error: message }, 502);
    }
  },
});
