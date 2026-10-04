import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { createApp } from '../app.tsx';
import { noGateGitHub } from '../commands/person-deps.ts';
import { systemClock } from '../ports/clock.ts';
import { createAccessFixture, fixtureAccessEnv, type AccessFixture } from './access-keys.ts';
import { postgresDeps } from './postgres.ts';

export type Html = { readonly status: number; readonly text: string; readonly headers: Headers };

let fixture: Promise<AccessFixture> | null = null;

type HtmlRequest = {
  readonly headers: Readonly<Record<string, string>>;
  readonly clock: Clock;
  readonly env: Readonly<Record<string, string>>;
  readonly form?: URLSearchParams;
};

async function htmlRequest(
  db: Database,
  email: string,
  path: string,
  request: HtmlRequest,
): Promise<Html> {
  fixture ??= createAccessFixture();
  const keys = await fixture;
  const token = await keys.sign({ email });
  const app = createApp(postgresDeps(db, keys, undefined, request.clock), noGateGitHub);
  const headers = { 'cf-access-jwt-assertion': token, accept: 'text/html', ...request.headers };
  const init =
    request.form === undefined
      ? { headers }
      : {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
          body: request.form.toString(),
        };
  const response = await app.request(path, init, { ...fixtureAccessEnv, ...request.env });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

export function getHtml(
  db: Database,
  email: string,
  path: string,
  headers: Readonly<Record<string, string>> = {},
  clock: Clock = systemClock,
): Promise<Html> {
  return htmlRequest(db, email, path, { headers, clock, env: {} });
}

export function getHtmlWithEnv(
  db: Database,
  email: string,
  path: string,
  env: Readonly<Record<string, string>>,
  clock: Clock = systemClock,
): Promise<Html> {
  return htmlRequest(db, email, path, { headers: {}, clock, env });
}

export function postForm(
  db: Database,
  email: string,
  path: string,
  form: URLSearchParams,
  headers: Readonly<Record<string, string>>,
): Promise<Html> {
  return htmlRequest(db, email, path, { headers, clock: systemClock, env: {}, form });
}
