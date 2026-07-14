import { describe, expect, it } from 'vitest';
import { cardToBlockKit } from '@chat-adapter/slack';
import { renderTriageCard, renderHelloCard, type TriageCard } from '../src/lib/slack';

/** Render through the same conversion Slack delivery uses, for assertions. */
function blocksFor(postable: ReturnType<typeof renderTriageCard>) {
  return cardToBlockKit(postable.card) as any[];
}

const holdCard: TriageCard = {
  verdict: 'HOLD',
  riskClass: 'moderate',
  dependency: 'rack',
  fromVersion: '2.2.8',
  toVersion: '2.2.10',
  citation: {
    version: '2.2.9',
    quote: 'Rack::Request#POST now returns an empty hash for requests without a body.',
  },
  reasoning: 'The 2.2.9 notes change the return value of Rack::Request#POST for body-less requests. That is runtime behavior, not a fix.',
  prUrl: 'https://github.com/dgalarza/creatorsignal/pull/42',
};

describe('renderTriageCard', () => {
  it('leads with the verdict in the header', () => {
    const postable = renderTriageCard(holdCard);
    const blocks = blocksFor(postable);
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text.text).toContain('⚠️ HOLD');
    expect(postable.fallbackText).toBe('⚠️ HOLD: rack 2.2.8 → 2.2.10');
  });

  it('shows the version bump and risk class as fields', () => {
    const blocks = blocksFor(renderTriageCard(holdCard));
    const fields = blocks[1].fields.map((f: any) => f.text).join('\n');
    expect(fields).toContain('rack 2.2.8 → 2.2.10');
    expect(fields).toContain('moderate');
  });

  it('quotes the cited changelog line with its version', () => {
    const blocks = blocksFor(renderTriageCard(holdCard));
    const quote = blocks[3].text.text;
    expect(quote).toContain('>Rack::Request#POST now returns an empty hash');
    expect(quote).toContain('2.2.9 release notes');
  });

  it('truncates over-long citations to stay video-legible', () => {
    const blocks = blocksFor(
      renderTriageCard({ ...holdCard, citation: { version: '2.2.9', quote: 'x'.repeat(500) } }),
    );
    const quotedLine = blocks[3].text.text.split('\n')[0];
    expect(quotedLine.length).toBeLessThanOrEqual(202); // '>' + 200 chars + ellipsis
    expect(quotedLine.endsWith('…')).toBe(true);
  });

  it('omits the quote block when there is no citation', () => {
    const blocks = blocksFor(renderTriageCard({ ...holdCard, verdict: 'NEEDS_REVIEW', citation: null }));
    expect(blocks.map((b) => b.type)).toEqual(['header', 'section', 'section', 'context']);
    expect(blocks[0].text.text).toContain('🔍 NEEDS-REVIEW');
  });

  it('links the pull request in the muted context footer', () => {
    const blocks = blocksFor(renderTriageCard(holdCard));
    const footer = blocks.at(-1);
    expect(footer.type).toBe('context');
    expect(footer.elements[0].text).toContain(holdCard.prUrl);
  });

  it('escapes mrkdwn control characters in notes-derived content', () => {
    const blocks = blocksFor(
      renderTriageCard({
        ...holdCard,
        reasoning: 'Watch out for <!channel> & <https://evil.example|fake links>.',
        citation: { version: '2.2.9', quote: 'Fixed CVE <!channel> patch now <https://evil.example/creds|Upgrade>.' },
      }),
    );
    const reasoning = blocks[2].text.text;
    const quote = blocks[3].text.text;
    for (const rendered of [reasoning, quote]) {
      expect(rendered).not.toContain('<!channel>');
      expect(rendered).not.toContain('<https://evil.example');
      expect(rendered).toContain('&lt;');
    }
  });

  it('flattens multi-line citations into a single quote line', () => {
    const blocks = blocksFor(renderTriageCard({ ...holdCard, citation: { version: '2.2.9', quote: 'line one\nline two' } }));
    const quote = blocks[3].text.text.split('\n')[0];
    expect(quote).toBe('>line one line two');
  });
});

describe('renderHelloCard', () => {
  it('renders a header, body, and station footer', () => {
    const postable = renderHelloCard();
    const blocks = blocksFor(postable);
    expect(postable.fallbackText).toContain('Factory channel online');
    expect(blocks.map((b) => b.type)).toEqual(['header', 'section', 'context']);
  });
});
