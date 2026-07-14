import { registerApiRoute } from '@mastra/core/server';
import { renderHelloCard } from '../../lib/slack';

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
    const mastra = c.get('mastra');
    const logger = mastra.getLogger();

    const sdk = mastra.getAgent('triageAgent').getChannels()?.sdk;
    const channelId = process.env.SLACK_CHANNEL_ID;
    const missing = !sdk
      ? 'Slack Channels not configured (SLACK_APP_TOKEN missing, or not yet connected)'
      : !channelId
        ? 'SLACK_CHANNEL_ID is not set'
        : null;
    if (missing) {
      logger?.error('Hello card delivery failed', { error: missing });
      return c.json({ delivered: false, error: missing }, 503);
    }

    try {
      const { card, fallbackText } = renderHelloCard();
      const sent = await sdk!.channel(`slack:${channelId}`).post({ card, fallbackText });
      logger?.info('Hello card delivered to Slack', { channel: channelId, ts: sent.id });
      return c.json({ delivered: true, channel: channelId, ts: sent.id }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.error('Hello card delivery failed', { error: message });
      return c.json({ delivered: false, error: message }, 502);
    }
  },
});
