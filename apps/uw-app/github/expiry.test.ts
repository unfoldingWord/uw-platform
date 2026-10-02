import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { fixtureApp } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const start = new Date('2026-10-02T12:00:00.000Z');
const tokenPath = '/app/installations/77/access_tokens';
const minutes = (count: number) => new Date(start.getTime() + count * 60_000);

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function issued(token: string, expiresAt: Date) {
  return { status: 201, body: { token, expires_at: expiresAt.toISOString() } };
}

function clocked(github: FixtureGitHub) {
  let now = start;
  github.on('GET', '/repos/o/r/pulls/1', { status: 200, body: { number: 1 } });
  const reads = createGitHubReads(app, { fetch: github.fetch, now: () => now });
  return {
    read: async (at: Date) => {
      now = at;
      return reads.pullRequest('o/r', 1);
    },
  };
}

function readTokens(github: FixtureGitHub): (string | null)[] {
  return github
    .requests()
    .filter((request) => request.path !== tokenPath)
    .map((request) => request.authorization);
}

describe('a unit of work re-mints a token near its expiry and never keeps a failed mint', () => {
  it('keeps the token until five minutes before it expires, then mints again', async () => {
    const github = fixtureGitHub();
    github.on('POST', tokenPath, [issued('ghs_a', minutes(60)), issued('ghs_b', minutes(120))]);
    const unit = clocked(github);
    await unit.read(start);
    await unit.read(minutes(54));
    await unit.read(minutes(56));
    await unit.read(minutes(60));
    expect(readTokens(github)).toEqual([
      'token ghs_a',
      'token ghs_a',
      'token ghs_b',
      'token ghs_b',
    ]);
  });

  it('retries the mint on the next request after a failed one', async () => {
    const github = fixtureGitHub();
    github.on('POST', tokenPath, [{ status: 502 }, issued('ghs_c', minutes(60))]);
    const unit = clocked(github);
    expect(await unit.read(start)).toEqual({ ok: false, failure: 'server_error', status: 502 });
    expect((await unit.read(start)).ok).toBe(true);
    expect(readTokens(github)).toEqual(['token ghs_c']);
  });

  it('answers a token without a valid expiry as malformed_response', async () => {
    const github = fixtureGitHub();
    github.on('POST', tokenPath, { status: 201, body: { token: 'ghs_d', expires_at: 'soon' } });
    expect(await clocked(github).read(start)).toEqual({
      ok: false,
      failure: 'malformed_response',
      status: 201,
    });
  });

  it('answers unreachable when minting throws, without letting the exception escape', async () => {
    const github = fixtureGitHub();
    const reads = createGitHubReads(app, {
      fetch: github.fetch,
      now: () => {
        throw new Error('clock broke');
      },
    });
    expect(await reads.pullRequest('o/r', 1)).toEqual({
      ok: false,
      failure: 'unreachable',
      status: null,
    });
  });
});
