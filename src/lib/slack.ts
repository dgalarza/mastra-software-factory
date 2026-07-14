/**
 * Slack output surface for the factory: card rendering via the chat SDK's
 * Card API (`Card`/`CardText`/`Fields`/`Field` from 'chat').
 *
 * Cards are designed for video legibility: verdict readable at thumbnail
 * distance, citation capped at two lines, no walls of text.
 *
 * This file only BUILDS cards — it has no Mastra dependency and does not
 * post anything. Posting goes through the Channels SDK obtained from the
 * agent (`agent.getChannels()!.sdk`), which lives in the Mastra-aware
 * layer (workflow steps, routes) per this repo's src/lib/ convention.
 */

import { Card, CardText, Fields, Field, type CardElement } from 'chat';

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

export interface Postable {
  card: CardElement;
  /** Notification-line fallback Slack shows outside the card. */
  fallbackText: string;
}

/**
 * Escape Slack mrkdwn control characters. Citations and reasoning are
 * derived from third-party release notes — without this, a malicious
 * changelog line could smuggle `<!channel>` pings or `<url|label>` spoofed
 * links into a card the team trusts as bot output. Neither the Card API's
 * `CardText` nor raw Block Kit escapes this automatically — it's on us
 * either way.
 */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderTriageCard(card: TriageCard): Postable {
  const label = VERDICT_LABEL[card.verdict];
  const bump = `${card.dependency} ${card.fromVersion} → ${card.toVersion}`;

  const children = [
    Fields([
      Field({ label: 'Dependency', value: escapeMrkdwn(bump) }),
      Field({ label: 'Risk', value: card.riskClass }),
    ]),
    CardText(escapeMrkdwn(card.reasoning)),
  ];

  if (card.citation) {
    // Single line for the quote block: collapse whitespace, cap length,
    // then escape (escaping last so an entity is never split by truncation).
    let quote = card.citation.quote.trim().replace(/\s+/g, ' ');
    if (quote.length > MAX_QUOTE_CHARS) quote = `${quote.slice(0, MAX_QUOTE_CHARS - 1)}…`;
    children.push(
      CardText(`>${escapeMrkdwn(quote)}\n_— ${escapeMrkdwn(`${card.dependency} ${card.citation.version}`)} release notes_`),
    );
  }

  // CardLink always renders as a full section, not a muted footer — a
  // muted CardText with hand-built link syntax reproduces the small,
  // de-emphasized footer look our card wants.
  children.push(CardText(`<${card.prUrl}|View the pull request>`, { style: 'muted' }));

  return {
    card: Card({ title: `${label} — ${card.dependency}`, children }),
    fallbackText: `${label}: ${bump}`,
  };
}

export function renderHelloCard(): Postable {
  return {
    card: Card({
      title: '🏭 Factory channel online',
      children: [
        CardText(
          'The software factory can post to this channel. Station 1 (dependency triage) will deliver its recommendation cards here.',
        ),
        CardText('software-factory · Station 1: Dependency Triage', { style: 'muted' }),
      ],
    }),
    fallbackText: '🏭 Factory channel online',
  };
}
