import { describe, expect, it } from 'vitest';
import { parseDependabotPr, parseDependabotTitle, parseDependabotBranch } from '../src/lib/dependabot';

describe('parseDependabotTitle', () => {
  it('parses a single gem bump', () => {
    expect(parseDependabotTitle('Bump rack from 2.2.8 to 2.2.10')).toEqual({
      recognized: true,
      grouped: false,
      dependency: 'rack',
      fromVersion: '2.2.8',
      toVersion: '2.2.10',
    });
  });

  it('parses pre-release versions', () => {
    expect(parseDependabotTitle('Bump sidekiq from 7.0.0.beta1 to 7.0.0')).toMatchObject({
      recognized: true,
      dependency: 'sidekiq',
      fromVersion: '7.0.0.beta1',
      toVersion: '7.0.0',
    });
  });

  it('strips the "in /dir" suffix on monorepo titles', () => {
    expect(parseDependabotTitle('Bump rack from 2.2.8 to 2.2.10 in /app')).toMatchObject({
      recognized: true,
      dependency: 'rack',
      fromVersion: '2.2.8',
      toVersion: '2.2.10',
    });
  });

  it('parses "Update ... requirement" titles', () => {
    expect(parseDependabotTitle('Update rspec-rails requirement from ~> 6.0 to ~> 6.1')).toMatchObject({
      recognized: true,
      dependency: 'rspec-rails',
    });
  });

  it('classifies grouped updates', () => {
    expect(parseDependabotTitle('Bump the rubocop group with 3 updates')).toEqual({
      recognized: true,
      grouped: true,
      dependency: 'rubocop',
      fromVersion: null,
      toVersion: null,
    });
  });

  it('rejects non-Dependabot titles', () => {
    expect(parseDependabotTitle('Add user avatars')).toMatchObject({ recognized: false });
  });
});

describe('parseDependabotBranch', () => {
  it('extracts the ecosystem from a bundler branch', () => {
    expect(parseDependabotBranch('dependabot/bundler/rack-2.2.10')).toEqual({
      ecosystem: 'bundler',
      directory: null,
    });
  });

  it('extracts the directory for monorepo updates', () => {
    expect(parseDependabotBranch('dependabot/npm_and_yarn/app/left-pad-1.3.0')).toEqual({
      ecosystem: 'npm_and_yarn',
      directory: 'app',
    });
  });

  it('returns nulls for non-Dependabot branches', () => {
    expect(parseDependabotBranch('feature/add-avatars')).toEqual({ ecosystem: null, directory: null });
  });
});

describe('parseDependabotPr', () => {
  it('combines title and branch fields', () => {
    expect(parseDependabotPr('Bump rack from 2.2.8 to 2.2.10', 'dependabot/bundler/rack-2.2.10')).toEqual({
      recognized: true,
      grouped: false,
      dependency: 'rack',
      fromVersion: '2.2.8',
      toVersion: '2.2.10',
      ecosystem: 'bundler',
      directory: null,
    });
  });
});
