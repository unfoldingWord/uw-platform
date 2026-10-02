import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { sql } from 'drizzle-orm';
import type { CapabilityWord, Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { platformStore } from '../ports/store.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import { systemClock } from '../ports/clock.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';

type Owner = { readonly id: string; readonly email: string; readonly adminGrant: string };

const KIM: Owner = {
  id: '00000000-0000-4000-8000-000000002601',
  email: 'writes-kim@unfoldingword.org',
  adminGrant: '00000000-0000-4000-8000-000000002611',
};
const LEE: Owner = {
  id: '00000000-0000-4000-8000-000000002602',
  email: 'writes-lee@unfoldingword.org',
  adminGrant: '00000000-0000-4000-8000-000000002621',
};
const ADA: Owner = {
  id: '00000000-0000-4000-8000-000000002603',
  email: 'writes-ada@unfoldingword.org',
  adminGrant: '00000000-0000-4000-8000-000000002631',
};

type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly drop: () => Promise<void>;
};

let rigged: Promise<Rig> | null = null;

function grantRow(id: string, personId: string, role: 'admin' | 'editor', area: string) {
  const grantedAt = new Date('2026-01-01T00:00:00.000Z');
  return { id, personId, role, scopeKind: 'jd_area' as const, scopeArea: area, grantedAt };
}

async function seedOwner(db: Database, owner: Owner, editorGrant: string): Promise<void> {
  await seedPerson(db, { id: owner.id, email: owner.email });
  await seedGrant(db, {
    ...grantRow(owner.adminGrant, owner.id, 'admin', '80-89'),
    expiresAt: null,
  });
  await seedGrant(db, { ...grantRow(editorGrant, owner.id, 'editor', '30-39'), expiresAt: null });
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedOwner(db, KIM, '00000000-0000-4000-8000-000000002612');
  await seedOwner(db, LEE, '00000000-0000-4000-8000-000000002622');
  await seedOwner(db, ADA, '00000000-0000-4000-8000-000000002632');
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', new Date());
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  const fixture = await createAccessFixture();
  return { db, fixture, kernel: kernelOn(db, systemClock), ian, drop };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function harnessOf(r: Rig): Promise<string> {
  const harnessId = crypto.randomUUID();
  const key = `writes-${harnessId.slice(0, 8)}`;
  const activate = { harnessId, harnessKey: key, jdArea: '80-89', template: software };
  value(await r.kernel.stages.activate(caller(r.ian), activate));
  return harnessId;
}

async function delegate(
  r: Rig,
  owner: Owner,
  harnessId: string,
  capability: CapabilityWord = 'iterate',
): Promise<string> {
  const person = await personOn(r.db, owner.id, owner.email, new Date());
  const input = { harnessId, persona: 'agent:iterate', expiresAt: null, supersedes: null };
  return value(await r.kernel.delegations.grant(caller(person), { ...input, capability })).id;
}

async function login(
  r: Rig,
  owner: Owner,
  delegationId: string,
  persona = 'iterate',
): Promise<Client> {
  const token = await r.fixture.signForMcp({ email: owner.email });
  return httpClient(createApp(postgresDeps(r.db, r.fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
    'x-uw-persona': persona,
    'x-uw-delegation': delegationId,
  });
}

function pageInput(pageId: string) {
  return {
    pageId,
    type: 'product',
    jdArea: '30-39',
    slug: `delegated-${pageId.slice(0, 8)}`,
    title: 'Delegated draft',
    parentId: null,
    frontmatter: { owner: `human:${KIM.id}`, summary: 'A page a delegated runner drafts.' },
    bodyMd: 'draft',
    expectedVersion: null,
  };
}

async function countOf(r: Rig, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await r.db.execute<{ n: number }>(query);
  return Number(rows[0]?.n ?? 0);
}

async function writesUnder(r: Rig, client: Client) {
  const pageId = crypto.randomUUID();
  const title = `task ${pageId}`;
  const page = await callTool(client, 'write_page', pageInput(pageId));
  const task = await callTool(client, 'create_task', {
    title,
    jdArea: '30-39',
    pageId: null,
    due: null,
  });
  const versions = await countOf(
    r,
    sql`SELECT count(*)::int AS n FROM page_versions WHERE page_id = ${pageId}`,
  );
  const tasks = await countOf(r, sql`SELECT count(*)::int AS n FROM tasks WHERE title = ${title}`);
  return { page, task, written: versions + tasks };
}

async function lapsesOn(r: Rig, harnessId: string): Promise<number> {
  const events = await platformStore(r.db).transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === 'delegation_lapsed').length;
}

describe.skipIf(!testServer)('AB-6 page and task verbs check the named delegation', () => {
  it('writes under a live delegation of the caller', async () => {
    const r = await rig();
    const delegationId = await delegate(r, KIM, await harnessOf(r));
    const outcome = await writesUnder(r, await login(r, KIM, delegationId));
    expect([outcome.page.isError, outcome.task.isError, outcome.written]).toEqual([
      false,
      false,
      2,
    ]);
  });

  it("refuses another person's delegation id as not found and writes nothing", async () => {
    const r = await rig();
    const lees = await delegate(r, LEE, await harnessOf(r));
    const outcome = await writesUnder(r, await login(r, KIM, lees));
    expect([outcome.page.body['reason'], outcome.task.body['reason']]).toEqual([
      'delegation_not_found',
      'delegation_not_found',
    ]);
    expect(outcome.written).toBe(0);
  });

  it('refuses a persona the delegation was not granted to and writes nothing', async () => {
    const r = await rig();
    const delegationId = await delegate(r, KIM, await harnessOf(r));
    const outcome = await writesUnder(r, await login(r, KIM, delegationId, 'review'));
    expect([outcome.page.body['reason'], outcome.task.body['reason']]).toEqual([
      'not_permitted',
      'not_permitted',
    ]);
    expect(outcome.written).toBe(0);
  });

  it('refuses a revoked delegation as lapsed and writes nothing', async () => {
    const r = await rig();
    const harnessId = await harnessOf(r);
    const delegationId = await delegate(r, KIM, harnessId);
    const person = await personOn(r.db, KIM.id, KIM.email, new Date());
    value(await r.kernel.delegations.revoke(caller(person), { delegationId }));
    const outcome = await writesUnder(r, await login(r, KIM, delegationId));
    expect([outcome.page.body['reason'], outcome.task.body['reason']]).toEqual([
      'delegation_lapsed',
      'delegation_lapsed',
    ]);
    expect(outcome.written).toBe(0);
  });
});

async function itemOn(r: Rig, harnessId: string): Promise<string> {
  const input = { harnessId, title: 'lapse', pageId: null, priority: 1, due: null };
  return value(await r.kernel.items.enqueue(caller(r.ian), { ...input, delegationId: null }))
    .itemId;
}

describe.skipIf(!testServer)('AB-6 a lapsed delegation stops every verb', () => {
  it('refuses context and writes once the owner loses the admin grant, recording the lapse once', async () => {
    const r = await rig();
    const harnessId = await harnessOf(r);
    const itemId = await itemOn(r, harnessId);
    const delegationId = await delegate(r, ADA, harnessId);
    await revokeSeededGrant(r.db, ADA.adminGrant, new Date());
    const client = await login(r, ADA, delegationId);
    const context = await callTool(client, 'resolve_context', { itemId });
    expect(context.body).toMatchObject({ reason: 'delegation_lapsed', detail: { delegationId } });
    const outcome = await writesUnder(r, client);
    expect([outcome.page.body['reason'], outcome.task.body['reason']]).toEqual([
      'delegation_lapsed',
      'delegation_lapsed',
    ]);
    expect(outcome.written).toBe(0);
    expect(await lapsesOn(r, harnessId)).toBe(1);
  });
});

describe.skipIf(!testServer)('AB-4 a delegation with capability none reads no scene', () => {
  it('answers get_health, resolve_context and stage_items as missing', async () => {
    const r = await rig();
    const harnessId = await harnessOf(r);
    const itemId = await itemOn(r, harnessId);
    const client = await login(r, KIM, await delegate(r, KIM, harnessId, 'none'));
    const health = await callTool(client, 'get_health', { harnessId });
    expect(health.body).toEqual({
      status: 'error',
      reason: 'harness_not_found',
      detail: { harnessId },
    });
    const context = await callTool(client, 'resolve_context', { itemId });
    expect(context.body).toEqual({ status: 'error', reason: 'item_not_found', detail: { itemId } });
    const params = { harnessId, stageKey: 'package' };
    const rows = await callTool(client, 'query_entities', { query: 'stage_items', params });
    expect(rows.body).toMatchObject({ status: 'error', reason: 'harness_not_found' });
  });

  it('reads the same scene under a working delegation', async () => {
    const r = await rig();
    const harnessId = await harnessOf(r);
    const itemId = await itemOn(r, harnessId);
    const client = await login(r, KIM, await delegate(r, KIM, harnessId));
    expect((await callTool(client, 'get_health', { harnessId })).isError).toBe(false);
    expect((await callTool(client, 'resolve_context', { itemId })).isError).toBe(false);
    const params = { harnessId, stageKey: 'package' };
    const rows = await callTool(client, 'query_entities', { query: 'stage_items', params });
    expect(rows.isError).toBe(false);
  });
});
