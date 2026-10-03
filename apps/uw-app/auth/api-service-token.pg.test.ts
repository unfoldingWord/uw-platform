import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { noGateGitHub } from '../commands/person-deps.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const routeParam = /:\w+/g;

function concrete(path: string): string {
  return path.replace(routeParam, randomUUID());
}

function methodOf(method: string): string {
  return method === 'ALL' ? 'GET' : method;
}

async function serviceTokensRefused(db: Database): Promise<void> {
  const fixture = await createAccessFixture();
  const app = createApp(postgresDeps(db, fixture), noGateGitHub);
  const routes = app.routes.filter((route) => route.path.startsWith('/api/'));
  expect(routes.length).toBeGreaterThanOrEqual(8);
  expect(routes.map((route) => route.path)).toEqual(
    expect.arrayContaining(['/api/harness/:harness/events', '/api/harness/:harness/gates/:item']),
  );
  const claims = { common_name: 'svc-runner' };
  const tokens = [await fixture.sign(claims), await fixture.signForMcp(claims)];
  for (const route of routes) {
    for (const token of tokens) {
      const method = methodOf(route.method);
      const raw = await app.request(
        concrete(route.path),
        {
          method,
          headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
          ...(method === 'GET' ? {} : { body: '{}' }),
        },
        fixtureAccessEnv,
      );
      const sent = { path: route.path, method, status: raw.status, body: await raw.json() };
      expect(sent).toEqual({
        path: route.path,
        method,
        status: 401,
        body: { status: 'error', reason: 'unauthenticated' },
      });
    }
  }
}

describe.skipIf(!testServer)('a service token reaches no /api route', () => {
  it('answers every registered /api route unauthenticated for a service token', () =>
    withAppDatabase(serviceTokensRefused));
});
