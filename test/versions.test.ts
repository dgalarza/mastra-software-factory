import { describe, expect, it } from 'vitest';
import { compareVersions, inBumpRange, versionFromTag } from '../src/lib/versions';

describe('compareVersions', () => {
  it('orders plain versions numerically', () => {
    expect(compareVersions('2.2.9', '2.2.10')).toBeLessThan(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('2.2', '2.2.0')).toBe(0);
    expect(compareVersions('2.2', '2.2.1')).toBeLessThan(0);
  });

  it('sorts prereleases before their release (Gem::Version style)', () => {
    expect(compareVersions('7.0.0.beta1', '7.0.0')).toBeLessThan(0);
    expect(compareVersions('7.0.0.rc1', '7.0.0.beta2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
  });

  it('ignores a leading v', () => {
    expect(compareVersions('v2.2.9', '2.2.9')).toBe(0);
  });
});

describe('inBumpRange', () => {
  it('is exclusive of from, inclusive of to', () => {
    expect(inBumpRange('2.2.8', '2.2.8', '2.2.10')).toBe(false);
    expect(inBumpRange('2.2.9', '2.2.8', '2.2.10')).toBe(true);
    expect(inBumpRange('2.2.10', '2.2.8', '2.2.10')).toBe(true);
    expect(inBumpRange('2.2.11', '2.2.8', '2.2.10')).toBe(false);
  });
});

describe('versionFromTag', () => {
  it('strips v prefixes and gem-name prefixes', () => {
    expect(versionFromTag('v2.2.9', 'rack')).toBe('2.2.9');
    expect(versionFromTag('2.2.9', 'rack')).toBe('2.2.9');
    expect(versionFromTag('rack-2.2.9', 'rack')).toBe('2.2.9');
    expect(versionFromTag('sidekiq-7.2.0', 'sidekiq')).toBe('7.2.0');
  });

  it('rejects tags that are not versions', () => {
    expect(versionFromTag('latest', 'rack')).toBeNull();
    expect(versionFromTag('some-feature', 'rack')).toBeNull();
  });
});
