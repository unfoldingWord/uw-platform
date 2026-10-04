import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import { noGateGitHub } from '../commands/person-deps.ts';
import type { HubNamespace } from '../env.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { softwareHarness } from '../testing/commands.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const missingHarness = '00000000-0000-4000-8000-0000000000ee';

type Forwarded = {
  readonly hub: string;
  readonly method: string;
  readonly path: string;
  readonly upgrade: string | null;
  readonly credential: string | null;
  readonly person: string | null;
  readonly screen: string | null;
  readonly item: string | null;
};

type RecordingHub = { readonly namespace: HubNamespace; readonly seen: Forwarded[] };

type Answer = { readonly status: number; readonly text: string; readonly hub: string | null };

type Ask = {
  readonly claims: Readonly<Record<string, unknown>>;
  readonly harnessId: string;
  readonly upgrade?: string | null;
  readonly hub?: RecordingHub;
  readonly audience?: 'app' | 'mcp';
  readonly method?: string;
  readonly query?: string;
  readonly device?: string;
};

let fixture: Promise<AccessFixture> | null = null;

function accessFixture(): Promise<AccessFixture> {
  fixture ??= createAccessFixture();
  return fixture;
}

function recordingHub(): RecordingHub {
  const seen: Forwarded[] = [];
  const namespace: HubNamespace = {
    idFromName: (name) => `id:${name}`,
    get: (id) => ({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        seen.push({
          hub: String(id),
          method: request.method,
          path: new URL(request.url).pathname,
          upgrade: request.headers.get('upgrade'),
          credential: request.headers.get('cf-access-jwt-assertion'),
          person: request.headers.get('x-hub-person'),
          screen: request.headers.get('x-hub-screen'),
          item: request.headers.get('x-hub-item'),
        });
        return new Response(null, { status: 200, headers: { 'x-hub': 'connected' } });
      },
    }),
  };
  return { namespace, seen };
}

async function connect(db: Database, ask: Ask): Promise<Answer> {
  const keys = await accessFixture();
  const token =
    ask.audience === 'mcp' ? await keys.signForMcp({ ...ask.claims }) : await keys.sign(ask.claims);
  const upgrade = ask.upgrade === undefined ? 'websocket' : ask.upgrade;
  const headers: Record<string, string> = { 'cf-access-jwt-assertion': token };
  if (upgrade !== null) headers.Upgrade = upgrade;
  if (ask.device !== undefined) headers['x-uw-device'] = ask.device;
  const env = ask.hub ? { ...fixtureAccessEnv, HARNESS_HUB: ask.hub.namespace } : fixtureAccessEnv;
  const raw = await createApp(postgresDeps(db, keys), noGateGitHub).request(
    `/api/harness/${ask.harnessId}/live${ask.query ?? ''}`,
    { method: ask.method ?? 'GET', headers },
    env,
  );
  return { status: raw.status, text: await raw.text(), hub: raw.headers.get('x-hub') };
}

const notFound = JSON.stringify({ status: 'error', reason: 'harness_not_found' });

describe.skipIf(!testServer)('WB-3 the live socket connects through can()', () => {
  it("WB-3 a reader's upgrade is forwarded to the harness's hub", () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const hub = recordingHub();
      const claims = { email: scene.viewer.email };
      const answer = await connect(db, { claims, harnessId: scene.harnessId, hub });
      expect(answer).toMatchObject({ status: 200, hub: 'connected' });
      const mixedCase = { claims, harnessId: scene.harnessId, hub, upgrade: 'WebSocket' };
      expect((await connect(db, mixedCase)).hub).toBe('connected');
      const forwarded = {
        hub: `id:${scene.harnessId}`,
        method: 'GET',
        path: '/connect',
        upgrade: 'websocket',
        credential: null,
        person: scene.viewer.id,
        screen: null,
        item: null,
      };
      expect(hub.seen).toEqual([forwarded, forwarded]);
    }));

  it('WB-3 a harness the person may not read answers harness_not_found and never reaches the hub', () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const hub = recordingHub();
      const claims = { email: scene.stranger.email };
      for (const harnessId of [scene.harnessId, missingHarness, 'not-a-harness']) {
        const answer = await connect(db, { claims, harnessId, hub });
        expect(answer).toEqual({ status: 404, text: notFound, hub: null });
      }
      const unwired = await connect(db, { claims, harnessId: scene.harnessId });
      expect(unwired).toEqual({ status: 404, text: notFound, hub: null });
      expect(hub.seen).toEqual([]);
    }));

  it('WB-3 a revoked grant refuses the next upgrade at the request instant', () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const hub = recordingHub();
      const ask = { claims: { email: scene.viewer.email }, harnessId: scene.harnessId, hub };
      expect((await connect(db, ask)).status).toBe(200);
      await revokeSeededGrant(db, scene.viewer.grantId, new Date(Date.now() - 1000));
      expect(await connect(db, ask)).toEqual({ status: 404, text: notFound, hub: null });
      expect(hub.seen).toHaveLength(1);
    }));
});

describe.skipIf(!testServer)('the live socket route refuses before the hub', () => {
  it('answers a request without an Upgrade header malformed_command with status 426', () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const hub = recordingHub();
      const claims = { email: scene.viewer.email };
      for (const upgrade of [null, 'h2c']) {
        const answer = await connect(db, { claims, harnessId: scene.harnessId, hub, upgrade });
        expect(answer.status).toBe(426);
        expect(JSON.parse(answer.text)).toEqual({ status: 'error', reason: 'malformed_command' });
      }
      expect(hub.seen).toEqual([]);
    }));

  it('answers not_wired to a reader when there is no HARNESS_HUB binding', () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const answer = await connect(db, {
        claims: { email: scene.viewer.email },
        harnessId: scene.harnessId,
      });
      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.text)).toEqual({ status: 'error', reason: 'not_wired' });
    }));

  it('refuses a service token and a token minted for the MCP audience', () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const hub = recordingHub();
      const service = await connect(db, {
        claims: { common_name: 'svc-reader' },
        harnessId: scene.harnessId,
        hub,
      });
      const mcp = await connect(db, {
        claims: { email: scene.viewer.email },
        harnessId: scene.harnessId,
        hub,
        audience: 'mcp',
      });
      for (const answer of [service, mcp]) {
        expect(answer.status).toBe(401);
        expect(JSON.parse(answer.text)).toEqual({ status: 'error', reason: 'unauthenticated' });
      }
      expect(hub.seen).toEqual([]);
    }));
});

describe.skipIf(!testServer)('the live socket route opens only on GET', () => {
  it('refuses a HEAD upgrade before the hub', () =>
    withAppDatabase(async (db) => {
      const scene = await softwareHarness(db);
      const hub = recordingHub();
      const claims = { email: scene.viewer.email };
      const answer = await connect(db, { claims, harnessId: scene.harnessId, hub, method: 'HEAD' });
      expect(answer).toMatchObject({ status: 400, hub: null });
      expect(hub.seen).toEqual([]);
    }));
});

const itemId = '00000000-0000-4000-8000-0000000000c1';

async function forwardsWatched(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const hub = recordingHub();
  const base = { claims: { email: scene.viewer.email }, harnessId: scene.harnessId, hub };
  expect((await connect(db, { ...base, query: '?screen=gates' })).status).toBe(200);
  const onItem = { ...base, query: `?screen=item&item=${itemId}` };
  expect((await connect(db, onItem)).status).toBe(200);
  expect(hub.seen.map((seen) => [seen.screen, seen.item])).toEqual([
    ['gates', null],
    ['item', itemId],
  ]);
}

async function refusesBadWatch(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const hub = recordingHub();
  const base = { claims: { email: scene.viewer.email }, harnessId: scene.harnessId, hub };
  const queries = ['?screen=nowhere', `?item=${itemId}`, '?screen=item', '?screen=item&item=x'];
  const reasons: unknown[] = [];
  for (const query of queries) {
    reasons.push(JSON.parse((await connect(db, { ...base, query })).text).reason);
  }
  expect(reasons).toEqual(queries.map(() => 'malformed_command'));
  expect(hub.seen).toEqual([]);
}

describe.skipIf(!testServer)('the live socket names the screen and item it watches', () => {
  it('forwards the screen and item of a person session to the hub', () =>
    withAppDatabase(forwardsWatched));
  it('refuses an unknown screen, or an item without the item screen, before the hub', () =>
    withAppDatabase(refusesBadWatch));
});
