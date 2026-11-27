import { exportPKCS8, generateKeyPair, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { googleDirectory, newUserBody, randomPassword } from './directory.ts';
import { fakeGoogle } from './testing/fake-google.ts';
import type { SubjectKind, TokenDeps } from './token.ts';

const admin = 'platform-admin@unfoldingword.org';
const harnessId = '00000000-0000-4000-8000-00000000d601';
let privateKey = '';
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

function rig(kind: SubjectKind = 'admin') {
  const google = fakeGoogle();
  google.trust(publicKey);
  google.addUser(admin);
  const tokens: TokenDeps = {
    account: { clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com', privateKey },
    fetcher: google.fetch,
    now: () => new Date('2026-11-27T09:00:00.000Z'),
    lookup: async (email) => (email === admin ? kind : null),
    cache: new Map(),
  };
  return { google, directory: googleDirectory({ tokens, adminSubject: admin }) };
}

const barnabas = {
  address: 'barnabas@unfoldingword.org',
  givenName: 'Barnabas',
  familyName: 'Assistant',
  orgUnitPath: '/Assistants',
  harnessId,
};

describe('PA-14 the Workspace directory client', () => {
  it('finds a user by address or by alias, and answers null for a free address', async () => {
    const { google, directory } = rig();
    google.directory.add('ana@unfoldingword.org', ['barnabas@unfoldingword.org']);
    expect(await directory.user('silas@unfoldingword.org')).toEqual({ ok: true, value: null });
    const alias = await directory.user('barnabas@unfoldingword.org');
    expect(alias).toMatchObject({ ok: true, value: { address: 'ana@unfoldingword.org' } });
  });

  it('creates the assistant user in its unit, marked with its harness, with a password it keeps nowhere', async () => {
    const { google, directory } = rig();
    const made = await directory.insert(barnabas);
    expect(made).toMatchObject({
      ok: true,
      value: { address: barnabas.address, suspended: false, harnessId },
    });
    expect(google.directory.user(barnabas.address)).toMatchObject({
      orgUnitPath: '/Assistants',
      name: { givenName: 'Barnabas', familyName: 'Assistant' },
      passwordSet: true,
    });
    expect(JSON.stringify(made)).not.toContain('password');
    expect(await directory.insert(barnabas)).toEqual({ ok: false, failure: 'conflict' });
  });

  it('suspends, restores and deletes the user, and a second delete is done', async () => {
    const { google, directory } = rig();
    await directory.insert(barnabas);
    expect(await directory.setSuspended(barnabas.address, true)).toEqual({ ok: true, value: null });
    expect(google.directory.user(barnabas.address)?.suspended).toBe(true);
    await directory.setSuspended(barnabas.address, false);
    expect(google.directory.user(barnabas.address)?.suspended).toBe(false);
    expect(await directory.remove(barnabas.address)).toEqual({ ok: true, value: null });
    expect(google.directory.user(barnabas.address)).toBeNull();
    expect(await directory.remove(barnabas.address)).toEqual({ ok: true, value: null });
  });

  it('is refused when the subject is not the admin subject', async () => {
    const { directory } = rig('person');
    expect(await directory.user('silas@unfoldingword.org')).toEqual({
      ok: false,
      failure: 'refused',
    });
  });

  it('makes a fresh long random password each time', () => {
    const first = randomPassword();
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(randomPassword()).not.toBe(first);
    expect(newUserBody(barnabas, first)).toMatchObject({ changePasswordAtNextLogin: false });
  });
});

describe('PA-14 the Workspace directory client reads groups', () => {
  it('finds a group by address or alias, and answers null for an address no group holds', async () => {
    const { google, directory } = rig();
    google.directory.addGroup('team@unfoldingword.org', ['barnabas@unfoldingword.org']);
    expect(await directory.group('silas@unfoldingword.org')).toEqual({ ok: true, value: null });
    expect(await directory.group('barnabas@unfoldingword.org')).toEqual({
      ok: true,
      value: { address: 'team@unfoldingword.org' },
    });
    const asked = google.requests().filter((request) => request.path.includes('/groups/'));
    expect(asked.map((request) => request.method)).toEqual(['GET', 'GET']);
  });
});
