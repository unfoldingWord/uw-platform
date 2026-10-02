import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { createShipWrites } from './ship-writes.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureReply } from './testing/fixture-github.ts';

const path = '/repos/o/r/pulls/2';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

async function readAnswering(reply: FixtureReply) {
  const github = fixtureGitHub();
  github.on('GET', path, reply);
  return createGitHubReads(app, fixtureTransport(github)).pullRequest('o/r', 2);
}

const statuses: [number, Record<string, string>, string][] = [
  [401, {}, 'unauthorized'],
  [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
  [403, { 'x-ratelimit-remaining': '12' }, 'forbidden'],
  [403, {}, 'forbidden'],
  [404, {}, 'not_found'],
  [405, {}, 'not_mergeable'],
  [409, {}, 'conflict'],
  [422, {}, 'unprocessable'],
  [429, {}, 'rate_limited'],
  [500, {}, 'server_error'],
  [502, {}, 'server_error'],
  [503, {}, 'server_error'],
];

describe('a GitHub answer maps to a closed set of failures', () => {
  it.each(statuses)('%i %j is %s', async (status, headers, failure) => {
    expect(await readAnswering({ status, headers, body: { message: 'no' } })).toEqual({
      ok: false,
      failure,
      status,
    });
  });

  it('a fetch that throws is unreachable', async () => {
    const transport = {
      fetch: () => Promise.reject(new TypeError('network down')),
      now: () => new Date(0),
    };
    expect(await createGitHubReads(app, transport).pullRequest('o/r', 2)).toEqual({
      ok: false,
      failure: 'unreachable',
      status: null,
    });
  });
});

describe('a GitHub answer that is not the expected shape, or a request never sent', () => {
  it('a 200 whose body is not JSON is malformed_response', async () => {
    expect(await readAnswering({ status: 200, body: '<html>oops</html>' })).toEqual({
      ok: false,
      failure: 'malformed_response',
      status: 200,
    });
    expect(
      await readAnswering({ status: 200, body: 'oops', headers: { 'content-type': 'text/html' } }),
    ).toEqual({ ok: false, failure: 'malformed_response', status: 200 });
  });

  it('a list read answered with an object is malformed_response', async () => {
    const github = fixtureGitHub();
    github.on('GET', '/repos/o/r/pulls/2/reviews', { status: 200, body: { reviews: [] } });
    expect(
      await createGitHubReads(app, fixtureTransport(github)).pullRequestReviews('o/r', 2),
    ).toEqual({
      ok: false,
      failure: 'malformed_response',
      status: 200,
    });
  });

  it('a merge GitHub will not make is not_mergeable', async () => {
    const github = fixtureGitHub();
    github.on('PUT', '/repos/o/r/pulls/2/merge', { status: 405, body: { message: 'no' } });
    const merge = { sha: 'a'.repeat(40), title: 't', message: 'm' };
    expect(await createShipWrites(app, fixtureTransport(github)).merge('o/r', 2, merge)).toEqual({
      ok: false,
      failure: 'not_mergeable',
      status: 405,
    });
  });

  it('a repository that is not owner/name is refused without a request', async () => {
    const github = fixtureGitHub();
    const reads = createGitHubReads(app, fixtureTransport(github));
    for (const repo of ['o', 'o/r/x', '/r', 'o/', '', 'o/..', 'o/.', 'o?/r', 'o/r#x', 'o/r x']) {
      expect(await reads.pullRequest(repo, 2)).toEqual({
        ok: false,
        failure: 'unprocessable',
        status: null,
      });
    }
    expect(github.requests()).toEqual([]);
  });
});
