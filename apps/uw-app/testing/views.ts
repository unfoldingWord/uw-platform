import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { createApp } from '../app.tsx';
import { noGateGitHub } from '../commands/person-deps.ts';
import { systemClock } from '../ports/clock.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { postgresDeps } from './postgres.ts';

export type Html = { readonly status: number; readonly text: string; readonly headers: Headers };

let fixture: Promise<AccessFixture> | null = null;

export async function getHtml(
  db: Database,
  email: string,
  path: string,
  headers: Readonly<Record<string, string>> = {},
  clock: Clock = systemClock,
): Promise<Html> {
  fixture ??= createAccessFixture();
  const keys = await fixture;
  const token = await keys.sign({ email });
  const response = await createApp(postgresDeps(db, keys, undefined, clock), noGateGitHub).request(
    path,
    { headers: { 'cf-access-jwt-assertion': token, accept: 'text/html', ...headers } },
    fixtureAccessEnv,
  );
  return { status: response.status, text: await response.text(), headers: response.headers };
}
