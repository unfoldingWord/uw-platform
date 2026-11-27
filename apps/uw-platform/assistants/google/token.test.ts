import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { googleCall } from './rest.ts';
import { fakeGoogle, FAKE_TOKEN_URL, type FakeGoogle } from './testing/fake-google.ts';
import {
  accessToken,
  GOOGLE_SCOPES,
  serviceAccountOf,
  type SubjectKind,
  type TokenCache,
  type TokenDeps,
} from './token.ts';

const now = new Date('2026-11-26T09:00:00.000Z');
const kinds: Readonly<Record<string, SubjectKind>> = {
  'ana@unfoldingword.org': 'person',
  'barnabas@unfoldingword.org': 'assistant_mailbox',
  'platform-admin@unfoldingword.org': 'admin',
};

let privateKey = '';
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

function rig(at: () => Date = () => now, key = privateKey) {
  const google = fakeGoogle();
  google.trust(publicKey);
  for (const email of Object.keys(kinds)) google.addUser(email);
  const cache: TokenCache = new Map();
  const deps: TokenDeps = {
    account: { clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com', privateKey: key },
    fetcher: google.fetch,
    now: at,
    lookup: async (email) => kinds[email] ?? null,
    cache,
  };
  return { google, deps, cache };
}

function tokenCalls(google: FakeGoogle) {
  return google.requests().filter((request) => request.path === '/token');
}

const calendar = [GOOGLE_SCOPES.calendarEvents];

describe('PA-8 the Workspace token minter signs a jwt-bearer assertion for an allowed subject', () => {
  it('signs RS256 with the service account as issuer and the person as subject', async () => {
    const { google, deps } = rig();
    const minted = await accessToken(deps, 'Ana@unfoldingword.org', calendar);
    expect(minted.ok).toBe(true);
    const [call] = tokenCalls(google);
    const form = call?.body as Record<string, string>;
    expect(form['grant_type']).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = form['assertion'] ?? '';
    expect(decodeProtectedHeader(assertion).alg).toBe('RS256');
    const seconds = now.getTime() / 1000;
    expect(decodeJwt(assertion)).toEqual({
      iss: 'assistants@uw-platform.iam.gserviceaccount.com',
      sub: 'ana@unfoldingword.org',
      aud: FAKE_TOKEN_URL,
      scope: GOOGLE_SCOPES.calendarEvents,
      iat: seconds,
      exp: seconds + 3600,
    });
    await expect(jwtVerify(assertion, publicKey, { currentDate: now })).resolves.toBeDefined();
  });

  it('refuses, before signing, a subject or scope outside the allowlist', async () => {
    const { google, deps } = rig();
    const asked: readonly [string, readonly string[]][] = [
      ['ana@unfoldingword.org', [GOOGLE_SCOPES.gmail]],
      ['ana@unfoldingword.org', [GOOGLE_SCOPES.directoryUser]],
      ['barnabas@unfoldingword.org', calendar],
      ['platform-admin@unfoldingword.org', calendar],
      ['stranger@unfoldingword.org', calendar],
      ['ana@unfoldingword.org', []],
    ];
    for (const [subject, scopes] of asked) {
      await expect(accessToken(deps, subject, scopes)).resolves.toEqual({
        ok: false,
        failure: 'not_allowed',
      });
    }
    expect(tokenCalls(google)).toEqual([]);
    expect((await accessToken(deps, 'barnabas@unfoldingword.org', [GOOGLE_SCOPES.gmail])).ok).toBe(
      true,
    );
    expect(
      (await accessToken(deps, 'platform-admin@unfoldingword.org', [GOOGLE_SCOPES.directoryUser]))
        .ok,
    ).toBe(true);
  });
});

describe('PA-8 the Workspace token minter reuses and refuses tokens', () => {
  it('reuses a token per subject and scope set until five minutes before it expires', async () => {
    let at = now;
    const { google, deps } = rig(() => at);
    const first = await accessToken(deps, 'ana@unfoldingword.org', calendar);
    const again = await accessToken(deps, 'ana@unfoldingword.org', calendar);
    expect(again).toEqual(first);
    expect(tokenCalls(google)).toHaveLength(1);
    await accessToken(deps, 'ana@unfoldingword.org', [GOOGLE_SCOPES.calendarFreeBusy]);
    expect(tokenCalls(google)).toHaveLength(2);
    at = new Date(now.getTime() + 54 * 60_000);
    await accessToken(deps, 'ana@unfoldingword.org', calendar);
    expect(tokenCalls(google)).toHaveLength(2);
    at = new Date(now.getTime() + 56 * 60_000);
    const renewed = await accessToken(deps, 'ana@unfoldingword.org', calendar);
    expect(tokenCalls(google)).toHaveLength(3);
    expect(renewed).not.toEqual(first);
  });

  it('answers refused when Google refuses the grant and unavailable when it cannot answer', async () => {
    const { google, deps } = rig();
    google.revokeScope(GOOGLE_SCOPES.calendarEvents);
    await expect(accessToken(deps, 'ana@unfoldingword.org', calendar)).resolves.toEqual({
      ok: false,
      failure: 'refused',
    });
    google.failNext(503);
    await expect(
      accessToken(deps, 'ana@unfoldingword.org', [GOOGLE_SCOPES.calendarFreeBusy]),
    ).resolves.toEqual({ ok: false, failure: 'unavailable' });
    const broken = { ...deps, fetcher: async () => Promise.reject(new Error('network')) };
    await expect(
      accessToken(broken, 'ana@unfoldingword.org', [GOOGLE_SCOPES.calendarFreeBusy]),
    ).resolves.toEqual({ ok: false, failure: 'unavailable' });
  });

  it('answers key_invalid for a key that is not PKCS#8', async () => {
    const { deps } = rig(
      () => now,
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    );
    await expect(accessToken(deps, 'ana@unfoldingword.org', calendar)).resolves.toEqual({
      ok: false,
      failure: 'key_invalid',
    });
  });
});

describe('PA-8 the Workspace key is the service account JSON', () => {
  it('reads the client email and the private key, with escaped newlines', () => {
    const json = JSON.stringify({
      type: 'service_account',
      client_email: 'assistants@uw-platform.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    expect(serviceAccountOf(json)).toEqual({
      clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });
    expect(serviceAccountOf(undefined)).toBeNull();
    expect(serviceAccountOf('not json')).toBeNull();
    expect(serviceAccountOf(JSON.stringify({ client_email: 'x@y.z' }))).toBeNull();
  });
});

describe('PA-8 a Google call re-mints a token Google no longer accepts', () => {
  it('forgets a rejected cached token and retries once with a fresh one', async () => {
    const { google, deps } = rig();
    deps.cache.set(
      `${deps.account.clientEmail}\nana@unfoldingword.org\n${GOOGLE_SCOPES.calendarEvents}`,
      { token: 'ya29.stale', expiresAt: new Date(now.getTime() + 3_600_000) },
    );
    const answer = await googleCall(deps, {
      subject: 'ana@unfoldingword.org',
      scopes: calendar,
      method: 'GET',
      url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=2026-11-26T00%3A00%3A00Z&timeMax=2026-11-27T00%3A00%3A00Z',
    });
    expect(answer.ok).toBe(true);
    expect(tokenCalls(google)).toHaveLength(1);
  });
});
