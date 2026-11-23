import { randomUUID } from 'node:crypto';
import type { Database } from '@uw/db/client';
import { seedGrant, seedHarness, seedPerson } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import {
  fakeKms,
  fakeKmsAccess,
  fakeKmsRegion,
  type FakeKms,
} from '../credentials/testing/fake-kms.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { postgresDeps } from './postgres.ts';

export const ROWAN = 'rowan.test@unfoldingword.org';
export const workflowId = '00000000-0000-4000-8000-0000000159b1';
export const cast = {
  admin: { id: '00000000-0000-4000-8000-0000000159a1', email: 'fin.admin@unfoldingword.org' },
  editor: { id: '00000000-0000-4000-8000-0000000159a2', email: 'fin.editor@unfoldingword.org' },
  viewer: { id: '00000000-0000-4000-8000-0000000159a3', email: 'fin.viewer@unfoldingword.org' },
  second: { id: '00000000-0000-4000-8000-0000000159a4', email: 'second.admin@unfoldingword.org' },
  outsider: { id: '00000000-0000-4000-8000-0000000159a5', email: 'tech.admin@unfoldingword.org' },
  orgViewer: { id: '00000000-0000-4000-8000-0000000159a6', email: 'org.viewer@unfoldingword.org' },
  orgEditor: { id: '00000000-0000-4000-8000-0000000159a7', email: 'org.editor@unfoldingword.org' },
  nobody: { id: '00000000-0000-4000-8000-0000000159a8', email: 'no.grant@unfoldingword.org' },
} as const;

type Role = 'admin' | 'editor' | 'viewer';

const grants: readonly (readonly [string, Role, string | null])[] = [
  [cast.admin.id, 'admin', '20-29'],
  [cast.editor.id, 'editor', '20-29'],
  [cast.viewer.id, 'viewer', '20-29'],
  [cast.second.id, 'admin', null],
  [cast.outsider.id, 'admin', '80-89'],
  [cast.orgViewer.id, 'viewer', null],
  [cast.orgEditor.id, 'editor', null],
];

export async function seedCast(db: Database): Promise<void> {
  for (const person of Object.values(cast)) await seedPerson(db, person);
  for (const [index, [personId, role, area]] of grants.entries()) {
    await seedGrant(db, {
      id: `00000000-0000-4000-8000-0000000159c${index}`,
      personId,
      role,
      scopeKind: area === null ? 'org' : 'jd_area',
      scopeArea: area,
      grantedAt: new Date('2026-11-01T00:00:00.000Z'),
      expiresAt: null,
    });
  }
  await seedHarness(db, { id: workflowId, key: 'monthly-close', jdArea: '20-29' });
}

type Answer = {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: Readonly<Record<string, unknown>>;
};

export type CredentialsApp = {
  readonly kms: FakeKms;
  readonly fixture: AccessFixture;
  readonly lines: string[];
  send(email: string, body: { command: string } & Record<string, unknown>): Promise<Answer>;
  reveal(email: string, credentialId: string): Promise<Answer>;
  get(email: string, path: string): Promise<Answer>;
  post(token: string, path: string, body: unknown): Promise<Answer>;
};

function bodyOf(text: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  } catch {
    return {};
  }
}

export async function credentialsApp(
  db: Database,
  options: { readonly keyService: boolean } = { keyService: true },
): Promise<CredentialsApp> {
  const fixture = await createAccessFixture();
  const kms = await fakeKms();
  const lines: string[] = [];
  const deps = { ...postgresDeps(db, fixture, (line) => lines.push(line)), fetch: kms.fetcher };
  const settings = {
    CREDENTIALS_KMS_REGION: fakeKmsRegion,
    CREDENTIALS_KMS_KEY_ID: kms.keyArn,
    CREDENTIALS_KMS_ACCESS_KEY_ID: fakeKmsAccess.accessKeyId,
    CREDENTIALS_KMS_SECRET_ACCESS_KEY: fakeKmsAccess.secretAccessKey,
  };
  const env = { ...fixtureAccessEnv, ...(options.keyService ? settings : {}) };
  const ask = async (path: string, init: RequestInit): Promise<Answer> => {
    const response = await createApp(deps).request(path, init, env);
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: bodyOf(text) };
  };
  const post = (token: string, path: string, body: unknown) =>
    ask(path, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    kms,
    fixture,
    lines,
    post,
    send: async (email, body) =>
      post(await fixture.sign({ email }), `/api/credentials/commands/${body.command}`, {
        requestId: randomUUID(),
        ...body,
      }),
    reveal: async (email, credentialId) =>
      post(await fixture.sign({ email }), '/api/credentials/reveal', {
        command: 'reveal_credential',
        requestId: randomUUID(),
        credentialId,
      }),
    get: async (email, path) =>
      ask(path, {
        headers: { 'cf-access-jwt-assertion': await fixture.sign({ email }), accept: 'text/html' },
      }),
  };
}
