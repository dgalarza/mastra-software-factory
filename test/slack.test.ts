import { describe, expect, it } from 'vitest';
import { renderTriageCard, renderHelloCard, type TriageCard } from '../src/lib/slack';

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
    const { text, blocks } = renderTriageCard(holdCard);
    const header = blocks[0] as any;
    expect(header.type).toBe('header');
    expect(header.text.text).toContain('⚠️ HOLD');
    expect(text).toBe('⚠️ HOLD: rack 2.2.8 → 2.2.10');
  });

  it('shows the version bump and risk class as fields', () => {
    const { blocks } = renderTriageCard(holdCard);
    const fields = (blocks[1] as any).fields.map((f: any) => f.text).join('\n');
    expect(fields).toContain('rack 2.2.8 → 2.2.10');
    expect(fields).toContain('moderate');
  });

  it('quotes the cited changelog line with its version', () => {
    const { blocks } = renderTriageCard(holdCard);
    const quote = (blocks[3] as any).text.text;
    expect(quote).toContain('>Rack::Request#POST now returns an empty hash');
    expect(quote).toContain('2.2.9 release notes');
  });

  it('truncates over-long citations to stay video-legible', () => {
    const { blocks } = renderTriageCard({
      ...holdCard,
      citation: { version: '2.2.9', quote: 'x'.repeat(500) },
    });
    const quote = (blocks[3] as any).text.text;
    const quotedLine = quote.split('\n')[0];
    expect(quotedLine.length).toBeLessThanOrEqual(202); // '>' + 200 chars + ellipsis
    expect(quotedLine.endsWith('…')).toBe(true);
  });

  it('omits the quote block when there is no citation', () => {
    const { blocks } = renderTriageCard({ ...holdCard, verdict: 'NEEDS_REVIEW', citation: null });
    const types = blocks.map((b: any) => b.type);
    expect(types).toEqual(['header', 'section', 'section', 'context']);
    expect((blocks[0] as any).text.text).toContain('🔍 NEEDS-REVIEW');
  });

  it('links the pull request in the context footer', () => {
    const { blocks } = renderTriageCard(holdCard);
    const context = (blocks.at(-1) as any).elements[0].text;
    expect(context).toContain(holdCard.prUrl);
  });

  it('escapes mrkdwn control characters in notes-derived content', () => {
    const { blocks } = renderTriageCard({
      ...holdCard,
      reasoning: 'Watch out for <!channel> & <https://evil.example|fake links>.',
      citation: { version: '2.2.9', quote: 'Fixed CVE <!channel> patch now <https://evil.example/creds|Upgrade>.' },
    });
    const reasoning = (blocks[2] as any).text.text;
    const quote = (blocks[3] as any).text.text;
    for (const rendered of [reasoning, quote]) {
      expect(rendered).not.toContain('<!channel>');
      expect(rendered).not.toContain('<https://evil.example');
      expect(rendered).toContain('&lt;');
    }
  });

  it('flattens multi-line citations into a single quote line', () => {
    const { blocks } = renderTriageCard({
      ...holdCard,
      citation: { version: '2.2.9', quote: 'line one\nline two' },
    });
    const quote = (blocks[3] as any).text.text.split('\n')[0];
    expect(quote).toBe('>line one line two');
  });
});

describe('renderHelloCard', () => {
  it('renders a header, body, and station footer', () => {
    const { text, blocks } = renderHelloCard();
    expect(text).toContain('Factory channel online');
    expect(blocks.map((b: any) => b.type)).toEqual(['header', 'section', 'context']);
  });
});
