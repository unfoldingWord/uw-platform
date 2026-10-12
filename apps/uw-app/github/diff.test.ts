import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const base = 'b'.repeat(40);
const head = 'a'.repeat(40);
const comparePath = `/repos/o/r/compare/${base}...${head}`;
const text = 'diff --git a/board.tsx b/board.tsx\n+const hello = "wörld";\n';
const bytes = new TextEncoder().encode(text).length;

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function serving(body: string): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', comparePath, {
    status: 200,
    body,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
  return github;
}

function compareRequests(github: FixtureGitHub) {
  return github.requests().filter((request) => request.path === comparePath);
}

describe('the review diff read', () => {
  it('HE-4 the diff is read by base and head SHA and refused over the budget without reading further', async () => {
    const github = serving(text);
    const reads = createGitHubReads(app, fixtureTransport(github));
    expect(await reads.diff('o/r', base, head, bytes)).toEqual({ kind: 'diff', text, bytes });
    const [asked] = compareRequests(github);
    expect(asked?.accept).toBe('application/vnd.github.diff');
    expect(asked?.authorization).toMatch(/^token ghs_fixture_/);
    const large = serving('x'.repeat(200_000));
    const over = await createGitHubReads(app, fixtureTransport(large)).diff('o/r', base, head, 100);
    expect(over).toEqual({ kind: 'too_large', bytes: null });
  });

  it('answers too large without asking GitHub for a budget that is not a non-negative safe integer', async () => {
    const github = serving(text);
    const reads = createGitHubReads(app, fixtureTransport(github));
    for (const budget of [Number.NaN, -1, 1.5, 2 ** 53]) {
      expect(await reads.diff('o/r', base, head, budget)).toEqual({
        kind: 'too_large',
        bytes: null,
      });
    }
    expect(compareRequests(github)).toEqual([]);
  });

  it('answers unavailable with the failure for a range GitHub does not know or a SHA that is not full', async () => {
    const github = fixtureGitHub();
    const reads = createGitHubReads(app, fixtureTransport(github));
    expect(await reads.diff('o/r', base, head, 80_000)).toEqual({
      kind: 'unavailable',
      reason: 'not_found',
    });
    expect(await reads.diff('o/r', 'main', head, 80_000)).toEqual({
      kind: 'unavailable',
      reason: 'unprocessable',
    });
  });
});

describe('the review diff body', () => {
  it('HE-4 answers unavailable, never an empty diff, when the compare answer carries no readable body', async () => {
    const github = fixtureGitHub();
    github.on('GET', comparePath, { status: 200 });
    const reads = createGitHubReads(app, fixtureTransport(github));
    expect(await reads.diff('o/r', base, head, 80_000)).toEqual({
      kind: 'unavailable',
      reason: 'malformed_response',
    });
    expect(compareRequests(github)).toHaveLength(1);
  });

  it('reads an empty compare body as an empty diff', async () => {
    const reads = createGitHubReads(app, fixtureTransport(serving('')));
    expect(await reads.diff('o/r', base, head, 80_000)).toEqual({
      kind: 'diff',
      text: '',
      bytes: 0,
    });
  });
});
