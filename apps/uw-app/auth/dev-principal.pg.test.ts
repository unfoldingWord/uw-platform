import { describe, expect, it } from 'vitest';
import { parsePrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { createAccessFixture } from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const dev = { DEV_PRINCIPAL_EMAIL: 'ian.lindsley@unfoldingword.org' };

async function meOnLocalhost(db: Database) {
  const deps = postgresDeps(db, await createAccessFixture());
  return createApp(deps).request('http://localhost:8787/api/me', {}, dev);
}

describe.skipIf(!testServer)('P21 FD-7 the dev-only principal through the middleware', () => {
  it('signs the dev person in on localhost when Access is not configured', () =>
    withAppDatabase(async (db) => {
      const response = await meOnLocalhost(db);
      expect(response.status).toBe(200);
      const body: { principal?: unknown } = await response.json();
      const principal = parsePrincipal(body.principal);
      expect(principal).toMatchObject({
        kind: 'person',
        personId: IAN_ID,
        email: 'ian.lindsley@unfoldingword.org',
        interactive: true,
      });
    }));
});
