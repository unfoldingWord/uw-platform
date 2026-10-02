import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

type Issue = { readonly id: number; readonly updated_at: string };

const issuesPath = '/repos/o/r/issues';
const since = new Date('2026-10-01T00:00:00.000Z');
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function minute(offset: number): string {
  return new Date(since.getTime() + offset * 60_000).toISOString();
}

function issue(id: number, offset: number): Issue {
  return { id, updated_at: minute(offset) };
}

function run(first: number, count: number, offset = first): Issue[] {
  return Array.from({ length: count }, (_, index) => issue(first + index, offset + index));
}

function listing(github: FixtureGitHub, pages: readonly unknown[][], maxPages = 5) {
  github.on(
    'GET',
    issuesPath,
    pages.map((body) => ({ status: 200, body })),
  );
  return createGitHubReads(app, fixtureTransport(github)).issuesSince('o/r', since, maxPages);
}

function searches(github: FixtureGitHub): Record<string, string>[] {
  return github
    .requests()
    .filter((request) => request.path === issuesPath)
    .map((request) => Object.fromEntries(new URLSearchParams(request.search)));
}

function idsOf(issues: readonly unknown[]): number[] {
  return issues.map((item) => (item as Issue).id);
}

const moved = issue(5, 200);

function movedListing(search: URLSearchParams): Issue[] {
  if (search.get('page') === '2') return [moved];
  if (search.get('since') === minute(100)) return [issue(100, 100), issue(101, 101), moved];
  return run(1, 100);
}

function movingTransport() {
  const github = fixtureGitHub();
  const transport = fixtureTransport(github);
  const fetch = (input: Parameters<typeof github.fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== issuesPath) return transport.fetch(input, init);
    const body = JSON.stringify(movedListing(url.searchParams));
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/json' } }));
  };
  return { ...transport, fetch };
}

describe('the issue listing pages by keyset from the greatest updated_at seen', () => {
  it('asks again from the last instant it saw, oldest first, and drops the repeat', async () => {
    const github = fixtureGitHub();
    const result = await listing(github, [run(1, 100), [issue(100, 100), ...run(101, 3)]]);
    expect(result.ok && idsOf(result.value.issues)).toEqual(run(1, 103).map((item) => item.id));
    expect(result.ok && result.value.capped).toBe(false);
    expect(searches(github)).toEqual([
      {
        since: since.toISOString(),
        state: 'all',
        sort: 'updated',
        direction: 'asc',
        per_page: '100',
        page: '1',
      },
      expect.objectContaining({ since: minute(100), page: '1' }),
    ]);
  });

  it('does not skip an item updated between two requests', async () => {
    const result = await createGitHubReads(app, movingTransport()).issuesSince('o/r', since, 5);
    const issues = result.ok ? result.value.issues : [];
    expect(new Set(idsOf(issues))).toEqual(new Set(run(1, 101).map((item) => item.id)));
    expect(issues.at(-1)).toEqual(moved);
  });

  it('keeps every item that ties on updated_at across a request boundary', async () => {
    const github = fixtureGitHub();
    const tied = [issue(98, 97), issue(99, 97), issue(100, 97)];
    const first = [...run(1, 97), ...tied];
    const second = [...tied, issue(101, 97), issue(102, 97)];
    const result = await listing(github, [first, second]);
    expect(result.ok && result.value.issues).toHaveLength(102);
    expect(searches(github)[1]).toMatchObject({ since: minute(97) });
  });
});

describe('the issue listing says when it was capped and what it could not key', () => {
  it('reports capped when the request limit of full pages was read', async () => {
    const github = fixtureGitHub();
    const result = await listing(github, [run(1, 100), run(101, 100), run(201, 100)], 2);
    expect(result.ok && result.value.capped).toBe(true);
    expect(result.ok && result.value.issues).toHaveLength(200);
    expect(searches(github)).toHaveLength(2);
  });

  it('reports capped when a full page makes no progress past a tie', async () => {
    const github = fixtureGitHub();
    const tied = Array.from({ length: 100 }, (_, index) => issue(index + 1, 0));
    const result = await listing(github, [tied, tied, tied]);
    expect(result.ok && result.value.capped).toBe(true);
    expect(searches(github)).toHaveLength(2);
  });

  it('counts the items it cannot key', async () => {
    const github = fixtureGitHub();
    const result = await listing(github, [[issue(1, 0), { id: 'x' }, { updated_at: 'never' }]]);
    expect(result.ok && result.value).toEqual({
      issues: [issue(1, 0)],
      capped: false,
      unparsed: 2,
    });
  });
});
