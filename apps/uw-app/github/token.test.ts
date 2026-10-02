import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGitHubReads } from './client.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const now = new Date('2026-10-02T12:00:00.000Z');
const seconds = now.getTime() / 1000;
const tokenPath = '/app/installations/77/access_tokens';

let privateKey = '';
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

function readsOver(github: FixtureGitHub, key = privateKey) {
  return createGitHubReads(
    { appId: '4242', installationId: '77', privateKey: key },
    { fetch: github.fetch, now: () => now },
  );
}

function programmed(): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', '/repos/o/r/pulls/1', { status: 200, body: { number: 1 } });
  github.on('GET', '/repos/o/r/commits/abc/check-runs', {
    status: 200,
    body: { total_count: 0, check_runs: [] },
  });
  return github;
}

function tokenRequests(github: FixtureGitHub) {
  return github.requests().filter((request) => request.path === tokenPath);
}

function bearerOf(authorization: string | null): string {
  expect(authorization?.startsWith('Bearer ')).toBe(true);
  return (authorization ?? '').slice('Bearer '.length);
}

async function expectAppJwt(authorization: string | null): Promise<void> {
  const jwt = bearerOf(authorization);
  expect(decodeProtectedHeader(jwt).alg).toBe('RS256');
  expect(decodeJwt(jwt)).toEqual({ iss: '4242', iat: seconds - 60, exp: seconds + 540 });
  await expect(jwtVerify(jwt, publicKey, { currentDate: now })).resolves.toBeDefined();
}

describe('GH-1 an installation token is minted once per unit of work', () => {
  it('mints one token for every read of one unit, and a new one for the next unit', async () => {
    const github = programmed();
    const first = readsOver(github);
    await first.pullRequest('o/r', 1);
    await first.checkRuns('o/r', 'abc');
    await readsOver(github).pullRequest('o/r', 1);
    const tokens = tokenRequests(github);
    expect(tokens.map((request) => request.method)).toEqual(['POST', 'POST']);
    for (const request of tokens) await expectAppJwt(request.authorization);
    const reads = github.requests().filter((request) => request.path !== tokenPath);
    expect(reads.map((request) => request.authorization)).toEqual([
      'token ghs_fixture_1',
      'token ghs_fixture_1',
      'token ghs_fixture_2',
    ]);
  });

  it('mints nothing for a unit that makes no request', () => {
    const github = programmed();
    readsOver(github);
    expect(github.requests()).toEqual([]);
  });
});

describe('an installation token is not minted from a wrong key or a refused App', () => {
  it('refuses a PKCS#1 key and sends nothing', async () => {
    const github = programmed();
    const pkcs1 = privateKey
      .replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----')
      .replace('-----END PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----');
    expect(await readsOver(github, pkcs1).pullRequest('o/r', 1)).toEqual({
      ok: false,
      failure: 'key_not_pkcs8',
      status: null,
    });
    expect(github.requests()).toEqual([]);
  });

  it('answers unauthorized when the token route refuses the App, and reads nothing', async () => {
    const github = programmed();
    github.on('POST', tokenPath, { status: 401, body: { message: 'Bad credentials' } });
    expect(await readsOver(github).pullRequest('o/r', 1)).toEqual({
      ok: false,
      failure: 'unauthorized',
      status: 401,
    });
    expect(github.requests().map((request) => request.path)).toEqual([tokenPath]);
  });

  it('answers malformed_response when the token route answers without a token', async () => {
    const github = programmed();
    github.on('POST', tokenPath, { status: 201, body: { expires_at: 'soon' } });
    expect(await readsOver(github).pullRequest('o/r', 1)).toEqual({
      ok: false,
      failure: 'malformed_response',
      status: 201,
    });
  });
});
