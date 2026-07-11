/**
 * Slack output surface for the factory: Block Kit card rendering plus
 * delivery via chat.postMessage.
 *
 * Cards are designed for video legibility: verdict readable at thumbnail
 * distance, citation capped at two lines, no walls of text.
 */

export type Verdict = 'MERGE' | 'HOLD' | 'NEEDS_REVIEW';
export type RiskClass = 'low' | 'moderate' | 'high';

export interface TriageCard {
  verdict: Verdict;
  riskClass: RiskClass;
  dependency: string;
  fromVersion: string;
  toVersion: string;
  /** The exact changelog line the verdict rests on, and where it appeared. */
  citation: { version: string; quote: string } | null;
  /** Two sentences max — card-sized. */
  reasoning: string;
  prUrl: string;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  MERGE: '✅ MERGE',
  HOLD: '⚠️ HOLD',
  NEEDS_REVIEW: '🔍 NEEDS-REVIEW',
};

/** Keep the cited line readable on a 1080p recording: two lines or less. */
const MAX_QUOTE_CHARS = 200;

type Block = Record<string, unknown>;

/**
 * Escape Slack mrkdwn control characters. Citations and reasoning are
 * derived from third-party release notes — without this, a malicious
 * changelog line could smuggle `<!channel>` pings or `<url|label>` spoofed
 * links into a card the team trusts as bot output.
 */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderTriageCard(card: TriageCard): { text: string; blocks: Block[] } {
  const label = VERDICT_LABEL[card.verdict];
  const bump = `${card.dependency} ${card.fromVersion} → ${card.toVersion}`;

  const blocks: Block[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${label} — ${card.dependency}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Dependency*\n${escapeMrkdwn(bump)}` },
        { type: 'mrkdwn', text: `*Risk*\n${card.riskClass}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: escapeMrkdwn(card.reasoning) },
    },
  ];

  if (card.citation) {
    // Single line for the quote block: collapse whitespace, cap length,
    // then escape (escaping last so an entity is never split by truncation).
    let quote = card.citation.quote.trim().replace(/\s+/g, ' ');
    if (quote.length > MAX_QUOTE_CHARS) quote = `${quote.slice(0, MAX_QUOTE_CHARS - 1)}…`;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `>${escapeMrkdwn(quote)}\n_— ${escapeMrkdwn(`${card.dependency} ${card.citation.version}`)} release notes_`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `<${card.prUrl}|View the pull request>` }],
  });

  // `text` is the notification-line fallback Slack shows outside the card.
  return { text: `${label}: ${bump}`, blocks };
}

export function renderHelloCard(): { text: string; blocks: Block[] } {
  return {
    text: '🏭 Factory channel online',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🏭 Factory channel online', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'The software factory can post to this channel. Station 1 (dependency triage) will deliver its recommendation cards here.',
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: 'software-factory · Station 1: Dependency Triage' }],
      },
    ],
  };
}

export interface SlackPostResult {
  channel: string;
  /** Slack message timestamp — doubles as the thread id for replies. */
  ts: string;
}

/**
 * Post a card to the factory channel via the Slack Web API.
 * Throws with Slack's error code on failure so callers surface it loudly
 * rather than dropping a triage on the floor.
 */
export async function postToSlack(message: { text: string; blocks: Block[] }): Promise<SlackPostResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  if (!channel) throw new Error('SLACK_CHANNEL_ID is not set');

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text: message.text, blocks: message.blocks }),
  });
  if (!res.ok) throw new Error(`Slack API HTTP ${res.status}`);

  const data = (await res.json()) as { ok: boolean; error?: string; channel?: string; ts?: string };
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return { channel: data.channel!, ts: data.ts! };
}
