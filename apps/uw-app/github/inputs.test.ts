import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { createIssueComments } from './comments.ts';
import type { GitHubResult } from './failures.ts';
import { createShipWrites } from './ship-writes.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub } from './testing/fixture-github.ts';

const sha = 'a'.repeat(40);
const refused = { ok: false, failure: 'unprocessable', status: null };

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

type Call = (number: number, sha: string) => Promise<GitHubResult<unknown>>;

function calls(): { readonly sent: () => number; readonly each: [string, Call][] } {
  const github = fixtureGitHub();
  const transport = fixtureTransport(github);
  const reads = createGitHubReads(app, transport);
  const writes = createShipWrites(app, transport);
  const comments = createIssueComments(app, transport);
  return {
    sent: () => github.requests().length,
    each: [
      ['pullRequest', (n) => reads.pullRequest('o/r', n)],
      ['changedFiles', (_n, s) => reads.changedFiles('o/r', s, s)],
      ['pullRequestReviews', (n) => reads.pullRequestReviews('o/r', n)],
      ['issueComments', (n) => reads.issueComments('o/r', n, new Date('2026-10-02T00:00:00.000Z'))],
      ['checkRuns', (_n, s) => reads.checkRuns('o/r', s)],
      ['comment', (n) => comments.comment('o/r', n, 'body')],
      ['merge', (n, s) => writes.merge('o/r', n, { sha: s, title: 't', message: 'm' })],
      ['tag', (_n, s) => writes.tag('o/r', 'harness/x', s)],
    ],
  };
}

describe('a GitHub call with a malformed number, sha or page limit is refused without a request', () => {
  it.each([0, -1, 1.5, Number.NaN, 2 ** 60])('refuses the number %d', async (number) => {
    const { sent, each } = calls();
    for (const [name, call] of each) {
      if (['checkRuns', 'changedFiles', 'tag'].includes(name)) continue;
      expect(await call(number, sha)).toEqual(refused);
    }
    expect(sent()).toBe(0);
  });

  it.each(['abc', 'A'.repeat(39), 'g'.repeat(40), `${sha} `, ''])(
    'refuses the sha %j',
    async (bad) => {
      const { sent, each } = calls();
      for (const [name, call] of each) {
        if (!['checkRuns', 'changedFiles', 'merge', 'tag'].includes(name)) continue;
        expect(await call(1, bad)).toEqual(refused);
      }
      expect(sent()).toBe(0);
    },
  );

  it.each([0, -2, 1.5])('refuses the issue page limit %d', async (maxPages) => {
    const github = fixtureGitHub();
    const reads = createGitHubReads(app, fixtureTransport(github));
    expect(await reads.issuesSince('o/r', null, maxPages)).toEqual(refused);
    expect(github.requests()).toEqual([]);
  });
});
