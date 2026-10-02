import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsePrincipal, type Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { bindServiceToken, revokeServiceToken } from '../agents/service-tokens.ts';
import { withPrincipal } from '../auth/principal-middleware.ts';
import { withDatabase } from '../database.ts';
import type { AppEnv } from '../deps.ts';
import { observe } from '../observe.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { personOn } from '../testing/kernel.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { withAgentPrincipal } from './mint.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const IAN_ID = '00000000-0000-4000-8000-000000000001';
const CLIENT = 'routine-1.access';
const ROUTINE_DEVICE = 'hourly-routine';
const DELEGATION = '00000000-0000-4000-8000-000000000999';
const granted = new Date('2026-01-01T00:00:00.000Z');

const people = {
  maker: { n: 1, email: 'mint-maker@unfoldingword.org' },
  viewer: { n: 2, email: 'mint-viewer@unfoldingword.org' },
  routine: { n: 3, email: 'mint-routine@unfoldingword.org' },
} as const;

type Who = keyof typeof people;
type Sent = { readonly status: number; readonly body: Record<string, unknown> };

const grantIds = {
  makerEditor: '00000000-0000-4000-8000-000000001901',
  makerAdmin: '00000000-0000-4000-8000-000000001902',
  viewer: '00000000-0000-4000-8000-000000001903',
  routineEditor: '00000000-0000-4000-8000-000000001904',
} as const;

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

function idOf(who: Who): string {
  return `00000000-0000-4000-8000-0000000009${String(people[who].n).padStart(2, '0')}`;
}

function areaGrant(
  id: string,
  personId: string,
  role: 'viewer' | 'editor' | 'admin',
  area: string,
) {
  return {
    id,
    personId,
    role,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt: granted,
    expiresAt: null,
  };
}

async function seedPeople(db: Database): Promise<void> {
  for (const who of Object.keys(people) as Who[]) {
    await seedPerson(db, { id: idOf(who), email: people[who].email });
  }
  await seedGrant(db, areaGrant(grantIds.makerEditor, idOf('maker'), 'editor', '80-89'));
  await seedGrant(db, areaGrant(grantIds.makerAdmin, idOf('maker'), 'admin', '30-39'));
  await seedGrant(db, areaGrant(grantIds.viewer, idOf('viewer'), 'viewer', '80-89'));
  await seedGrant(db, areaGrant(grantIds.routineEditor, idOf('routine'), 'editor', '80-89'));
}

function probeApp(db: Database): Hono<AppEnv> {
  const deps = postgresDeps(db, fixture);
  const app = new Hono<AppEnv>();
  app.use(observe(deps));
  app.use(withDatabase(deps));
  app.use(withPrincipal(deps));
  app.use(withAgentPrincipal());
  app.get('/mcp/probe', (c) => c.json({ principal: c.get('principal') }));
  return app;
}

async function probe(
  db: Database,
  claims: Record<string, unknown> | null,
  headers: Record<string, string> = {},
): Promise<Sent> {
  const sent = { ...headers };
  if (claims) sent['cf-access-jwt-assertion'] = await fixture.signForMcp(claims);
  const raw = await probeApp(db).request('/mcp/probe', { headers: sent }, fixtureAccessEnv);
  return { status: raw.status, body: (await raw.json()) as Record<string, unknown> };
}

function asPerson(db: Database, who: Who, headers: Record<string, string> = {}) {
  return probe(db, { email: people[who].email }, headers);
}

function asToken(db: Database, headers: Record<string, string> = {}, commonName = CLIENT) {
  return probe(db, { common_name: commonName }, headers);
}

function principalOf(sent: Sent): Principal {
  expect(sent.status).toBe(200);
  return parsePrincipal(sent.body['principal']);
}

function refusalOf(sent: Sent): [number, unknown] {
  return [sent.status, sent.body['reason']];
}

function areasOf(principal: Principal) {
  return principal.grants.map((grant) => [grant.role, grant.scopeArea]);
}

async function ian(db: Database): Promise<Principal> {
  return personOn(db, IAN_ID, IAN, new Date());
}

async function bindRoutine(db: Database): Promise<void> {
  const command = {
    command: 'bind_service_token' as const,
    requestId: randomUUID(),
    clientId: CLIENT,
    personId: idOf('routine'),
    device: ROUTINE_DEVICE,
  };
  const bound = await bindServiceToken(db, await ian(db), command, randomUUID(), new Date());
  expect(bound).toEqual({ ok: true });
}

async function revokeRoutine(db: Database): Promise<void> {
  const command = {
    command: 'revoke_service_token' as const,
    requestId: randomUUID(),
    clientId: CLIENT,
  };
  expect(await revokeServiceToken(db, await ian(db), command, new Date())).toEqual({ ok: true });
}

function withPeople(work: (db: Database) => Promise<void>): Promise<void> {
  return withAppDatabase(async (db) => {
    await seedPeople(db);
    await work(db);
  });
}

function revokeNow(db: Database, grantId: string): Promise<void> {
  return revokeSeededGrant(db, grantId, new Date());
}

describe.skipIf(!testServer)('AB-2 the edge mints agent identities from an Access login', () => {
  it("mints agent:<person>/<device>, interactive, with the person's grants", () =>
    withPeople(async (db) => {
      const minted = principalOf(await asPerson(db, 'maker', { 'x-uw-device': 'laptop' }));
      expect(minted.identity).toBe(`agent:${idOf('maker')}/laptop`);
      expect(minted.kind).toBe('agent');
      expect(minted.personId).toBe(idOf('maker'));
      expect(minted.email).toBeNull();
      expect(minted.interactive).toBe(true);
      expect(areasOf(minted)).toEqual([
        ['editor', '80-89'],
        ['admin', '30-39'],
      ]);
    }));

  it('refuses a login with no device header, and a device that breaks the device rule', () =>
    withPeople(async (db) => {
      expect(refusalOf(await asPerson(db, 'maker'))).toEqual([400, 'malformed_command']);
      const upper = await asPerson(db, 'maker', { 'x-uw-device': 'Laptop' });
      expect(refusalOf(upper)).toEqual([400, 'malformed_command']);
    }));

  it('refuses a person who holds only viewer, and a request with no Access login', () =>
    withPeople(async (db) => {
      const viewer = await asPerson(db, 'viewer', { 'x-uw-device': 'laptop' });
      expect(refusalOf(viewer)).toEqual([403, 'not_permitted']);
      const anonymous = await probe(db, null, { 'x-uw-device': 'laptop' });
      expect(refusalOf(anonymous)).toEqual([401, 'unauthenticated']);
    }));
});

describe.skipIf(!testServer)('AB-2 a grant the owner loses is lost on the next request', () => {
  it('refuses the next request once the last editor grant is revoked', () =>
    withPeople(async (db) => {
      const device = { 'x-uw-device': 'laptop' };
      expect(principalOf(await asPerson(db, 'routine', device)).grants).toHaveLength(1);
      await revokeNow(db, grantIds.routineEditor);
      expect(refusalOf(await asPerson(db, 'routine', device))).toEqual([403, 'not_permitted']);
    }));

  it('mints the next request without the revoked area', () =>
    withPeople(async (db) => {
      const device = { 'x-uw-device': 'laptop' };
      expect(areasOf(principalOf(await asPerson(db, 'maker', device)))).toContainEqual([
        'editor',
        '80-89',
      ]);
      await revokeNow(db, grantIds.makerEditor);
      const narrowed = principalOf(await asPerson(db, 'maker', device));
      expect(narrowed.identity).toBe(`agent:${idOf('maker')}/laptop`);
      expect(areasOf(narrowed)).toEqual([['admin', '30-39']]);
    }));
});

describe.skipIf(!testServer)(
  'AB-2 the edge mints agent identities from a bound service token',
  () => {
    it("mints agent:<person>/<bound device>, not interactive, with the owner's grants", () =>
      withPeople(async (db) => {
        await bindRoutine(db);
        const minted = principalOf(await asToken(db));
        expect(minted.identity).toBe(`agent:${idOf('routine')}/${ROUTINE_DEVICE}`);
        expect(minted.interactive).toBe(false);
        expect(areasOf(minted)).toEqual([['editor', '80-89']]);
        const named = await asToken(db, { 'x-uw-device': ROUTINE_DEVICE });
        expect(principalOf(named).identity).toBe(minted.identity);
      }));

    it('looks up a client id with surrounding whitespace as its trimmed binding', () =>
      withPeople(async (db) => {
        await bindRoutine(db);
        const minted = principalOf(await asToken(db, {}, `  ${CLIENT}  `));
        expect(minted.identity).toBe(`agent:${idOf('routine')}/${ROUTINE_DEVICE}`);
      }));

    it('refuses an unbound token and a revoked binding unauthenticated', () =>
      withPeople(async (db) => {
        expect(refusalOf(await asToken(db))).toEqual([401, 'unauthenticated']);
        await bindRoutine(db);
        await revokeRoutine(db);
        expect(refusalOf(await asToken(db))).toEqual([401, 'unauthenticated']);
      }));

    it('refuses a device header that differs from the binding', () =>
      withPeople(async (db) => {
        await bindRoutine(db);
        const other = await asToken(db, { 'x-uw-device': 'laptop' });
        expect(refusalOf(other)).toEqual([400, 'malformed_command']);
      }));

    it('refuses a token whose owner lost the last editor grant, or is no longer active', () =>
      withPeople(async (db) => {
        await bindRoutine(db);
        await db.execute(sql`UPDATE people SET status = 'pending' WHERE id = ${idOf('routine')}`);
        expect(refusalOf(await asToken(db))).toEqual([403, 'pending_approval']);
        await db.execute(sql`UPDATE people SET status = 'active' WHERE id = ${idOf('routine')}`);
        await revokeNow(db, grantIds.routineEditor);
        expect(refusalOf(await asToken(db))).toEqual([403, 'not_permitted']);
      }));
  },
);

describe.skipIf(!testServer)(
  'AB-6 the edge mints the delegated form from the runner headers',
  () => {
    const delegated = { 'x-uw-persona': 'iterate', 'x-uw-delegation': DELEGATION };

    it('mints <device> as <persona> via delegation:<id> for a login and a bound token', () =>
      withPeople(async (db) => {
        const login = await asPerson(db, 'maker', { 'x-uw-device': 'laptop', ...delegated });
        expect(principalOf(login).identity).toBe(
          `agent:${idOf('maker')}/laptop as iterate via delegation:${DELEGATION}`,
        );
        await bindRoutine(db);
        expect(principalOf(await asToken(db, delegated)).identity).toBe(
          `agent:${idOf('routine')}/${ROUTINE_DEVICE} as iterate via delegation:${DELEGATION}`,
        );
      }));

    it('refuses a persona without its delegation, and a delegation without its persona', () =>
      withPeople(async (db) => {
        const persona = { 'x-uw-device': 'laptop', 'x-uw-persona': 'iterate' };
        expect(refusalOf(await asPerson(db, 'maker', persona))).toEqual([400, 'malformed_command']);
        const delegation = { 'x-uw-device': 'laptop', 'x-uw-delegation': DELEGATION };
        const sent = await asPerson(db, 'maker', delegation);
        expect(refusalOf(sent)).toEqual([400, 'malformed_command']);
      }));
  },
);

function bareApp(db: Database, seed: (c: Context<AppEnv>) => void): Hono<AppEnv> {
  const deps = postgresDeps(db, fixture);
  const app = new Hono<AppEnv>();
  app.use(observe(deps));
  app.use(withDatabase(deps));
  app.use(async (c, next) => {
    c.set('now', new Date());
    seed(c);
    await next();
  });
  app.use(withAgentPrincipal());
  app.get('/mcp/probe', (c) => c.json({ principal: c.get('principal') }));
  return app;
}

function leaveUnset(): void {
  return undefined;
}

function setPersonAccess(c: Context<AppEnv>): void {
  c.set('access', { kind: 'person', email: people.maker.email });
}

async function sendBare(app: Hono<AppEnv>): Promise<Sent> {
  const raw = await app.request(
    '/mcp/probe',
    { headers: { 'x-uw-device': 'laptop' } },
    fixtureAccessEnv,
  );
  return { status: raw.status, body: (await raw.json()) as Record<string, unknown> };
}

async function probeRepeated(db: Database, headers: [string, string][]): Promise<Sent> {
  const token = await fixture.signForMcp({ email: people.maker.email });
  const raw = await probeApp(db).request(
    '/mcp/probe',
    { headers: [['cf-access-jwt-assertion', token], ...headers] },
    fixtureAccessEnv,
  );
  return { status: raw.status, body: (await raw.json()) as Record<string, unknown> };
}

describe.skipIf(!testServer)('the edge refuses minting it cannot ground', () => {
  it('refuses unauthenticated when no Access identity was set, or no person principal', () =>
    withPeople(async (db) => {
      const unset = bareApp(db, leaveUnset);
      expect(refusalOf(await sendBare(unset))).toEqual([401, 'unauthenticated']);
      const personless = bareApp(db, setPersonAccess);
      expect(refusalOf(await sendBare(personless))).toEqual([401, 'unauthenticated']);
    }));

  it('refuses a device or persona header sent twice with different values', () =>
    withPeople(async (db) => {
      const devices = await probeRepeated(db, [
        ['x-uw-device', 'laptop'],
        ['x-uw-device', 'desktop'],
      ]);
      expect(refusalOf(devices)).toEqual([400, 'malformed_command']);
      const personas = await probeRepeated(db, [
        ['x-uw-device', 'laptop'],
        ['x-uw-persona', 'iterate'],
        ['x-uw-persona', 'review'],
        ['x-uw-delegation', DELEGATION],
      ]);
      expect(refusalOf(personas)).toEqual([400, 'malformed_command']);
    }));

  it("refuses a token's wrong device before it reads the owner's status", () =>
    withPeople(async (db) => {
      await bindRoutine(db);
      await db.execute(sql`UPDATE people SET status = 'pending' WHERE id = ${idOf('routine')}`);
      const wrong = await asToken(db, { 'x-uw-device': 'laptop' });
      expect(refusalOf(wrong)).toEqual([400, 'malformed_command']);
    }));
});
