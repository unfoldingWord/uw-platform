import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { appCssPath } from '@uw/ui/generated/app-css';
import { createApp } from './app.tsx';
import { islandsPath } from './generated/islands.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from './testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from './testing/postgres.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';
const IAN = 'ian.lindsley@unfoldingword.org';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

async function signedIn(db: Database, path: string): Promise<Response> {
  const token = await fixture.sign({ email: IAN });
  return createApp(postgresDeps(db, fixture)).request(
    path,
    { headers: { 'cf-access-jwt-assertion': token } },
    { ...fixtureAccessEnv, COMMIT_SHA: commit },
  );
}

describe.skipIf(!testServer)('uw-app shell for a signed-in person', () => {
  it('serves a server-rendered page at the root', () =>
    withAppDatabase(async (db) => {
      const response = await signedIn(db, '/');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      expect(html).toContain('<nav aria-label="Main"');
      expect(html).toContain('<main id="main"');
      expect(html).toContain(`<link rel="stylesheet" href="${appCssPath}"`);
      expect(html).toMatch(/<h1[^>]*>Waiting on you<\/h1>/);
      expect(html).toContain(`<script type="module" src="${islandsPath}"></script>`);
    }));

  it('reports the deployed commit on the probe', () =>
    withAppDatabase(async (db) => {
      const response = await signedIn(db, '/health/probe');
      expect(await response.json()).toMatchObject({ commit });
    }));

  it('answers an unknown path with the not-found screen and no exception text', () =>
    withAppDatabase(async (db) => {
      const response = await signedIn(db, '/nowhere');
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('We could not find that page');
      expect((await signedIn(db, '/api/nowhere')).status).toBe(404);
    }));
});
