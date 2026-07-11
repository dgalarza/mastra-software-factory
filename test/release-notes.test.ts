import { describe, expect, it } from 'vitest';
import { sliceChangelog } from '../src/mastra/tools/get-release-notes';

const CHANGELOG = `# Changelog

## [2.2.11] - 2026-01-05

- Future fix out of range

## [2.2.10] - 2025-10-14

### Security

- Fixed ReDoS in header parsing. ([CVE-2025-0001])

## [2.2.9] - 2025-03-01

### Changed

- Rack::Request#POST now returns an empty hash for requests without a body.

## [2.2.8] - 2024-12-01

- Old release, out of range
`;

describe('sliceChangelog', () => {
  it('returns only sections in the (from, to] range, oldest first', () => {
    const sections = sliceChangelog(CHANGELOG, '2.2.8', '2.2.10');
    expect(sections.map((s) => s.version)).toEqual(['2.2.9', '2.2.10']);
    expect(sections[0].notes).toContain('Rack::Request#POST now returns an empty hash');
    expect(sections[1].notes).toContain('ReDoS');
    expect(sections[1].notes).not.toContain('Future fix');
  });

  it('handles bare and v-prefixed headings', () => {
    const log = `## v1.2.0\n- added flag\n\n## 1.1.0\n- fixed bug\n`;
    const sections = sliceChangelog(log, '1.0.0', '1.2.0');
    expect(sections.map((s) => s.version)).toEqual(['1.1.0', '1.2.0']);
  });

  it('drops empty sections', () => {
    const log = `## 1.1.0\n\n## 1.0.1\n- a fix\n`;
    const sections = sliceChangelog(log, '1.0.0', '1.1.0');
    expect(sections.map((s) => s.version)).toEqual(['1.0.1']);
  });

  it('returns nothing when no headings parse', () => {
    expect(sliceChangelog('just some prose', '1.0.0', '2.0.0')).toEqual([]);
  });

  it('does not treat body prose mentioning versions as section boundaries', () => {
    const log = [
      '## 2.2.10',
      '- Versions 2.2.5 through 2.2.8 are affected by this issue',
      '- Second fix line that must stay in 2.2.10',
      '3.2 and 3.1 remain supported release series',
      '## 2.2.8',
      '- out of range',
    ].join('\n');
    const sections = sliceChangelog(log, '2.2.8', '2.2.10');
    expect(sections.map((s) => s.version)).toEqual(['2.2.10']);
    expect(sections[0].notes).toContain('Second fix line');
    expect(sections[0].notes).toContain('3.2 and 3.1 remain supported');
  });

  it('does not treat prose headings like "Upgrading from 2.1 to 2.2" as versions', () => {
    const log = ['## 2.2.0', '- real notes', '## Upgrading from 2.1 to 2.2', 'guide text', '## 2.1.0', '- older'].join('\n');
    const sections = sliceChangelog(log, '2.1.0', '2.2.0');
    expect(sections.map((s) => s.version)).toEqual(['2.2.0']);
    expect(sections[0].notes).toContain('guide text'); // prose heading stays inside the section
  });

  it('recognizes "Version x.y.z" headings and bare date-decorated headings', () => {
    const log = ['## Version 1.2.0', '- feature', '1.1.0 (2024-01-01)', '- fix'].join('\n');
    const sections = sliceChangelog(log, '1.0.0', '1.2.0');
    expect(sections.map((s) => s.version)).toEqual(['1.1.0', '1.2.0']);
  });
});
