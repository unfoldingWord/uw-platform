import { describe, expect, it } from 'vitest';
import { gateLink, homeLink, itemLink } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { platformStore } from '../ports/store.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import {
  accepted,
  callerOf,
  enqueued,
  ian,
  softwareHarness,
  type Scene,
} from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { gateWorld } from '../testing/gate-world.ts';
import { getHtml } from '../testing/views.ts';
import { pushStore } from './push/store.ts';
import {
  endpointFor,
  recordingFetch,
  subscription,
  vapidFixture,
  type VapidFixture,
} from './testing.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';

type Wired = {
  readonly db: Database;
  readonly scene: Scene;
  readonly vapid: VapidFixture;
  readonly calls: ReturnType<typeof recordingFetch>['calls'];
  readonly lines: Record<string, unknown>[];
  readonly fetcher: typeof fetch;
};

async function wired(db: Database): Promise<Wired> {
  const scene = await softwareHarness(db);
  const vapid = await vapidFixture();
  await pushStore(db).subscribe(IAN_ID, await subscription(endpointFor('ian')), new Date());
  const recorded = recordingFetch(() => new Response(null, { status: 201 }));
  return { db, scene, vapid, calls: recorded.calls, lines: [], fetcher: recorded.fetcher };
}

function appOf(w: Wired) {
  const keys = createAccessFixture();
  return keys.then((fixture) => ({
    fixture,
    app: createApp({
      ...postgresDeps(w.db, fixture, (line) =>
        w.lines.push(JSON.parse(line) as Record<string, unknown>),
      ),
      fetch: w.fetcher,
    }),
  }));
}

async function moveTo(db: Database, itemId: string, stageKey: string): Promise<void> {
  await platformStore(db).transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null) throw new Error('item vanished');
    await tx.harnessItems.write.project({ ...item, stageKey });
  });
}

function pushSent(w: Wired): Record<string, unknown>[] {
  return w.lines.filter((line) => line['outcome'] === 'push_sent');
}

async function parkedThroughCommands(db: Database): Promise<void> {
  const w = await wired(db);
  const itemId = await enqueued(db, w.scene.harnessId, 'Tweak the board');
  await moveTo(db, itemId, 'validate');
  const { fixture, app } = await appOf(w);
  const send = async (name: string) => {
    const token = await fixture.sign({ email: w.scene.editor.email });
    return app.request(
      `/api/harness/${w.scene.harnessId}/commands/${name}`,
      {
        method: 'POST',
        headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
        body: JSON.stringify({ command: name, requestId: crypto.randomUUID(), itemId }),
      },
      { ...fixtureAccessEnv, ...w.vapid.env },
    );
  };
  expect((await send('claim')).status).toBe(200);
  const tweaked = await send('tweak_package');
  expect(tweaked.status).toBe(200);
  expect(w.calls.map((call) => call.url)).toEqual([endpointFor('ian')]);
  expect(pushSent(w)).toEqual([
    expect.objectContaining({ trace_id: tweaked.headers.get('x-trace-id'), person_id: IAN_ID }),
  ]);
}

async function parkedThroughMcp(db: Database): Promise<void> {
  const w = await wired(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  const admin = await ian(db);
  const change = { agentPickup: 'allowed' as const, exitGate: 'human_approval' as const };
  const harnessId = w.scene.harnessId;
  accepted(
    await kernel.stages.updateStage(callerOf(admin), { harnessId, stageKey: 'package', change }),
  );
  const itemId = await enqueued(db, harnessId, 'Park the board from a runner');
  const { fixture, app } = await appOf(w);
  const token = await fixture.signForMcp({ email: w.scene.editor.email });
  const env = { ...fixtureAccessEnv, ...w.vapid.env };
  const client = await httpClient(
    app,
    { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' },
    env,
  );
  expect((await callTool(client, 'claim_item', { itemId, delegationId: null })).isError).toBe(
    false,
  );
  const submitted = await callTool(client, 'submit_to_gate', {
    itemId,
    evidence: {},
    to: null,
    pullRequest: null,
    head: null,
  });
  expect(submitted.body).toMatchObject({ result: 'parked' });
  expect(w.calls.map((call) => call.url)).toEqual([endpointFor('ian')]);
  expect(pushSent(w)).toHaveLength(1);
}

async function linksOpen(db: Database): Promise<void> {
  const world = await gateWorld(db);
  const { harnessId, itemId } = world.item;
  for (const link of [gateLink(harnessId, itemId), itemLink(harnessId, itemId), homeLink]) {
    const page = await getHtml(db, world.ianEmail, link);
    expect([link, page.status, page.headers.get('content-type')?.split(';')[0]]).toEqual([
      link,
      200,
      'text/html',
    ]);
  }
}

describe.skipIf(!testServer)('the notifier is wired into the kernels that append', () => {
  it('NT-1 a parked submit through the command API wakes the deciders by web push through the platform notifier', () =>
    withAppDatabase(parkedThroughCommands));
  it('NT-1 a parked submit through the MCP surface wakes the deciders by web push', () =>
    withAppDatabase(parkedThroughMcp));
  it('NT-2 every deep link a wake carries opens a view', () => withAppDatabase(linksOpen));
});
