import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const tokenPath = '/app/installations/77/access_tokens';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function pageOf(size: number): { status: number; body: unknown[] } {
  return { status: 200, body: Array.from({ length: size }, (_, index) => ({ index })) };
}

function pages(full: number, last: number | null) {
  const replies = Array.from({ length: full }, () => pageOf(100));
  return last === null ? replies : [...replies, pageOf(last)];
}

function sent(github: FixtureGitHub, path: string) {
  return github.requests().filter((request) => request.path === path && request.path !== tokenPath);
}

function readsOver(github: FixtureGitHub) {
  return createGitHubReads(app, fixtureTransport(github));
}

const head = 'c'.repeat(40);
const comparePath = `/repos/o/r/compare/main...${head}`;

function filesOf(size: number): { status: number; body: unknown } {
  const files = Array.from({ length: size }, (_, index) => ({ filename: `f${index}` }));
  return { status: 200, body: { status: 'ahead', commits: [], files } };
}

describe('GH-5 the changed files are read by head SHA, never by pull request number', () => {
  it('reads the files of the comparison from the base to that exact head', async () => {
    const github = fixtureGitHub();
    github.on('GET', comparePath, filesOf(3));
    const result = await readsOver(github).changedFiles('o/r', 'main', head);
    expect(result.ok && Array.isArray(result.value) && result.value.length).toBe(3);
    expect(sent(github, comparePath).map((request) => request.search)).toEqual([
      '?per_page=1&page=1',
    ]);
  });

  it('answers too_many_files when the comparison reaches the 300 files GitHub lists', async () => {
    const github = fixtureGitHub();
    github.on('GET', comparePath, filesOf(300));
    expect(await readsOver(github).changedFiles('o/r', 'main', head)).toEqual({
      ok: true,
      value: 'too_many_files',
    });
  });

  it('reads 299 files as the whole list', async () => {
    const github = fixtureGitHub();
    github.on('GET', comparePath, filesOf(299));
    const result = await readsOver(github).changedFiles('o/r', 'main', head);
    expect(result.ok && Array.isArray(result.value) && result.value.length).toBe(299);
  });

  it('reads a comparison with no files listed as no files', async () => {
    const github = fixtureGitHub();
    github.on('GET', comparePath, { status: 200, body: { status: 'identical', commits: [] } });
    expect(await readsOver(github).changedFiles('o/r', 'main', head)).toEqual({
      ok: true,
      value: [],
    });
  });

  it.each(['', 'a..b', 'main...x', 'with space', '-flag'])(
    'refuses the base %j without a request',
    async (base) => {
      const github = fixtureGitHub();
      expect(await readsOver(github).changedFiles('o/r', base, head)).toEqual({
        ok: false,
        failure: 'unprocessable',
        status: null,
      });
      expect(github.requests()).toEqual([]);
    },
  );
});

describe('the GitHub issue reads page from an instant up to a page limit', () => {
  it('reads issues updated since an instant, oldest first, across every state', async () => {
    const github = fixtureGitHub();
    github.on('GET', '/repos/o/r/issues', pages(1, 3));
    const since = new Date('2026-10-01T00:00:00.000Z');
    const result = await readsOver(github).issuesSince('o/r', since, 5);
    expect(result.ok && result.value.issues.length).toBe(103);
    expect(result.ok && result.value.capped).toBe(false);
    const search = new URLSearchParams(sent(github, '/repos/o/r/issues')[0]?.search);
    expect(Object.fromEntries(search)).toEqual({
      since: '2026-10-01T00:00:00.000Z',
      state: 'all',
      sort: 'updated',
      direction: 'asc',
      per_page: '100',
      page: '1',
    });
  });

  it('reports capped when the page limit of full issue pages was read', async () => {
    const github = fixtureGitHub();
    github.on('GET', '/repos/o/r/issues', pages(5, null));
    const result = await readsOver(github).issuesSince('o/r', null, 2);
    expect(result).toEqual({
      ok: true,
      value: { issues: expect.any(Array) as unknown, capped: true },
    });
    const requests = sent(github, '/repos/o/r/issues');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.search).not.toContain('since');
  });
});

describe('the other GitHub list reads are whole or refused', () => {
  it('refuses a list longer than ten pages rather than answer part of it', async () => {
    const github = fixtureGitHub();
    github.on('GET', '/repos/o/r/pulls/2/reviews', pages(11, null));
    expect(await readsOver(github).pullRequestReviews('o/r', 2)).toEqual({
      ok: false,
      failure: 'unprocessable',
      status: null,
    });
    expect(sent(github, '/repos/o/r/pulls/2/reviews')).toHaveLength(10);
  });

  it('pages the check runs and the installation repositories out of their wrappers', async () => {
    const github = fixtureGitHub();
    const wrapped = (key: string, size: number) => ({
      status: 200,
      body: { total_count: 150, [key]: pageOf(size).body },
    });
    github.on('GET', `/repos/o/r/commits/${'a'.repeat(40)}/check-runs`, [
      wrapped('check_runs', 100),
      wrapped('check_runs', 50),
    ]);
    github.on('GET', '/installation/repositories', wrapped('repositories', 2));
    const reads = readsOver(github);
    const runs = await reads.checkRuns('o/r', 'a'.repeat(40));
    expect(runs.ok && runs.value.length).toBe(150);
    const repositories = await reads.installationRepositories();
    expect(repositories.ok && repositories.value.length).toBe(2);
  });
});
