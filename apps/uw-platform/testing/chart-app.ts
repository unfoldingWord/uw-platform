import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { createApp } from '../app.tsx';
import { noGateGitHub } from '../commands/person-deps.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { postgresDeps } from './postgres.ts';

let fixture: Promise<AccessFixture> | null = null;

export type Posted = { readonly status: number; readonly body: unknown };

export async function postJson(
  db: Database,
  email: string,
  path: string,
  body: unknown,
  clock: Clock,
): Promise<Posted> {
  fixture ??= createAccessFixture();
  const keys = await fixture;
  const token = await keys.sign({ email });
  const app = createApp(postgresDeps(db, keys, undefined, clock), noGateGitHub);
  const response = await app.request(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
    },
    fixtureAccessEnv,
  );
  return { status: response.status, body: await response.json() };
}
