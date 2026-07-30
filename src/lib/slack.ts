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

import type { Verification } from './rspec';
import type { ProbeSummary } from './probes';

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
  /** Workflow-authored from the rspec artifact (see lib/rspec); Station 2 cards carry it. */
  verification?: Verification;
  /** Workflow-authored from the probe artifact (see lib/probes), when the audit tested the tests. */
  probes?: ProbeSummary;
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

  if (card.verification) {
    children.push(CardText(renderVerificationLine(card.verification)));
  }

  if (card.probes?.ran) {
    children.push(CardText(renderProbeLine(card.probes)));
  }

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

/**
 * One line of executed evidence. This renders what the ARTIFACT said —
 * the workflow builds it from the rspec JSON, never from agent claims.
 */
function renderVerificationLine(v: Verification): string {
  if (v.result === 'error') {
    return `🧪 *Tests:* not verified — ${escapeMrkdwn(v.errorReason ?? 'unknown error')}`;
  }
  const duration = v.durationSeconds != null ? ` in ${v.durationSeconds.toFixed(0)}s` : '';
  if (v.result === 'fail') {
    const first = v.failingExamples[0];
    const example = first ? ` — first: ${escapeMrkdwn(first)}` : '';
    return `🧪 *Tests:* ❌ ${v.failureCount}/${v.exampleCount} failed${duration}${example}`;
  }
  return `🧪 *Tests:* ✅ ${v.exampleCount} examples passed${duration}`;
}

/**
 * One line of assertion evidence. Counts come from the probe helper's own
 * records, so this states a fact rather than repeating an agent claim.
 */
function renderProbeLine(p: ProbeSummary): string {
  // Inconclusive probes are reported, never counted as findings — saying
  // "2 inconclusive" is honest; folding them into a failure count is not.
  const inconclusive = p.errored.length > 0 ? `, ${p.errored.length} inconclusive` : '';
  if (p.missed.length > 0) {
    const first = p.missed[0];
    return `🔬 *Assertions:* ⚠️ ${p.missed.length}/${p.total} stayed GREEN while broken — e.g. ${escapeMrkdwn(first.spec)}${inconclusive}`;
  }
  if (p.total === 0) {
    return `🔬 *Assertions:* ⚠️ no probe completed (${p.errored.length} inconclusive) — assertion health unverified`;
  }
  return `🔬 *Assertions:* ✅ ${p.detected}/${p.total} still fail when their subject is removed${inconclusive}`;
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
