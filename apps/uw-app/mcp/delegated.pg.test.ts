import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  delegatedIdentity,
  principalSchema,
  type CapabilityWord,
  type HarnessEvent,
  type Principal,
  defaultCiChecks,
} from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedActivePersona, seedGrant, seedPerson } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type Kernel } from '@uw/harness';
import { bindServiceToken } from '../agents/service-tokens.ts';
import { createApp } from '../app.tsx';
import { platformStore } from '../ports/store.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { listForDispatch } from '../testing/dispatch.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const ROUTINE = 'hourly-routine';
const MISSING = '00000000-0000-4000-8000-000000001699';

type Owner = {
  readonly id: string;
  readonly email: string;
  readonly client: string;
  readonly adminGrant: string;
  readonly editorGrant: string;
};

const KIM: Owner = {
  id: '00000000-0000-4000-8000-000000001601',
  email: 'delegated-kim@unfoldingword.org',
  client: 'routine-1.access',
  adminGrant: '00000000-0000-4000-8000-000000001611',
  editorGrant: '00000000-0000-4000-8000-000000001612',
};
const LEE: Owner = {
  id: '00000000-0000-4000-8000-000000001602',
  email: 'delegated-lee@unfoldingword.org',
  client: 'routine-2.access',
  adminGrant: '00000000-0000-4000-8000-000000001621',
  editorGrant: '00000000-0000-4000-8000-000000001622',
};
const ADA: Owner = {
  id: '00000000-0000-4000-8000-000000001603',
  email: 'delegated-ada@unfoldingword.org',
  client: 'routine-3.access',
  adminGrant: '00000000-0000-4000-8000-000000001631',
  editorGrant: '00000000-0000-4000-8000-000000001632',
};

type Body = Record<string, unknown>;
type SettableClock = { now(): Date; advance(milliseconds: number): void };
type Rig = {
  readonly db: Database;
  readonly second: Database;
  readonly clock: SettableClock;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly drop: () => Promise<void>;
};
type Scene = { readonly harnessId: string; readonly itemIds: readonly string[] };

let rigged: Promise<Rig> | null = null;

function settableClock(): SettableClock {
  let current = Date.now();
  return { now: () => new Date(current), advance: (ms) => void (current += ms) };
}

function grantRow(id: string, personId: string, role: 'admin' | 'editor', area: string) {
  const grantedAt = new Date('2026-01-01T00:00:00.000Z');
  const scope = { scopeKind: 'jd_area' as const, scopeArea: area };
  return { id, personId, role, ...scope, grantedAt, expiresAt: null };
}

async function seedOwner(db: Database, owner: Owner): Promise<void> {
  await seedPerson(db, { id: owner.id, email: owner.email });
  await seedGrant(db, grantRow(owner.adminGrant, owner.id, 'admin', '80-89'));
  await seedGrant(db, grantRow(owner.editorGrant, owner.id, 'editor', '30-39'));
}

async function bind(r: Rig, owner: Owner): Promise<void> {
  const command = {
    command: 'bind_service_token' as const,
    requestId: crypto.randomUUID(),
    clientId: owner.client,
    personId: owner.id,
    device: ROUTINE,
  };
  const bound = await bindServiceToken(r.db, r.ian, command, crypto.randomUUID(), r.clock.now());
  expect(bound).toEqual({ ok: true });
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  const second = createClient(database.connectionString);
  const clock = settableClock();
  await seedOwner(db, KIM);
  await seedOwner(db, LEE);
  await seedOwner(db, ADA);
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', clock.now());
  const drop = async () => {
    await Promise.all([db.$client.end(), second.$client.end()]);
    await database.drop();
  };
  const r = {
    db,
    second,
    clock,
    fixture: await createAccessFixture(),
    kernel: kernelOn(db, clock),
    ian,
    drop,
  };
  await bind(r, KIM);
  await bind(r, LEE);
  return r;
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

async function sceneOf(r: Rig, key: string, count: number): Promise<Scene> {
  const harnessId = crypto.randomUUID();
  const activate = {
    harnessId,
    harnessKey: key,
    jdArea: '80-89',
    template: software,
    repository: `unfoldingWord/${key}`,
    requiredChecks: [...defaultCiChecks],
  };
  value(await r.kernel.stages.activate(caller(r.ian), activate));
  await listForDispatch(r.db, activate.repository);
  const change = { agentPickup: 'allowed' as const, bracket: 'iterate' as const };
  value(
    await r.kernel.stages.updateStage(caller(r.ian), { harnessId, stageKey: 'package', change }),
  );
  const itemIds: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const input = { harnessId, title: `${key} ${n}`, pageId: null, priority: 1, due: null };
    const enqueued = await r.kernel.items.enqueue(caller(r.ian), { ...input, delegationId: null });
    itemIds.push(value(enqueued).itemId);
  }
  return { harnessId, itemIds };
}

function at(scene: Scene, n: number): string {
  const itemId = scene.itemIds[n];
  if (itemId === undefined) throw new Error(`no item ${n}`);
  return itemId;
}

async function delegate(
  r: Rig,
  owner: Owner,
  harnessId: string,
  capability: CapabilityWord = 'iterate',
): Promise<string> {
  const person = await personOn(r.db, owner.id, owner.email, r.clock.now());
  const input = { harnessId, persona: 'agent:iterate', expiresAt: null, supersedes: null };
  const granted = value(await r.kernel.delegations.grant(caller(person), { ...input, capability }));
  await seedActivePersona(r.db, {
    identity: 'agent:iterate',
    harnessId,
    frontmatter: { capability: 'iterate' },
  });
  return granted.id;
}

async function revoke(r: Rig, owner: Owner, delegationId: string): Promise<void> {
  const person = await personOn(r.db, owner.id, owner.email, r.clock.now());
  value(await r.kernel.delegations.revoke(caller(person), { delegationId }));
}

function delegationHeaders(delegationId: string | null): Record<string, string> {
  if (delegationId === null) return {};
  return { 'x-uw-persona': 'iterate', 'x-uw-delegation': delegationId };
}

async function connect(
  r: Rig,
  headers: Record<string, string>,
  db: Database = r.db,
): Promise<Client> {
  const app = createApp(postgresDeps(db, r.fixture, undefined, r.clock));
  return httpClient(app, headers);
}

async function routine(
  r: Rig,
  owner: Owner,
  delegationId: string | null,
  db: Database = r.db,
): Promise<Client> {
  const token = await r.fixture.signForMcp({ common_name: owner.client });
  const headers = { 'cf-access-jwt-assertion': token, ...delegationHeaders(delegationId) };
  return connect(r, headers, db);
}

async function login(r: Rig, owner: Owner, delegationId: string): Promise<Client> {
  const token = await r.fixture.signForMcp({ email: owner.email });
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  return connect(r, { ...headers, ...delegationHeaders(delegationId) });
}

function routineIdentity(owner: Owner, delegationId: string): string {
  return delegatedIdentity(`agent:${owner.id}/${ROUTINE}`, 'iterate', delegationId);
}

async function body(client: Client, name: string, args: Body): Promise<Body> {
  return (await callTool(client, name, args)).body;
}

function claim(client: Client, itemId: string, delegationId: string | null): Promise<Body> {
  return body(client, 'claim_item', { itemId, delegationId });
}

function step(client: Client, itemId: string): Promise<Body> {
  const run = { runId: crypto.randomUUID(), step: 'work', tokensIn: 50, tokensOut: 10 };
  return body(client, 'record_run_step', { itemId, ...run, costBasis: 'subscription' });
}

function submit(client: Client, itemId: string): Promise<Body> {
  const input = { itemId, evidence: {}, to: null, pullRequest: null, head: null };
  return body(client, 'submit_to_gate', input);
}

async function logOf(r: Rig, harnessId: string): Promise<readonly HarnessEvent[]> {
  return platformStore(r.db).transaction((tx) => readAllEvents(tx, harnessId, null));
}

async function itemLog(r: Rig, scene: Scene, itemId: string): Promise<readonly HarnessEvent[]> {
  return (await logOf(r, scene.harnessId)).filter((event) => event.itemId === itemId);
}

async function lapses(r: Rig, scene: Scene, delegationId: string) {
  const log = await logOf(r, scene.harnessId);
  return log
    .filter((event) => event.name === 'delegation_lapsed')
    .filter((event) => event.evidence['delegationId'] === delegationId)
    .map((event) => [event.evidence['why'], event.actor]);
}

async function claimedLive(r: Rig, scene: Scene, n: number) {
  const delegationId = await delegate(r, KIM, scene.harnessId);
  const runner = await routine(r, KIM, delegationId);
  expect(await claim(runner, at(scene, n), delegationId)).toMatchObject({ itemId: at(scene, n) });
  return { delegationId, runner };
}

async function runsUnderItsDelegation(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-run', 1);
  const bare = await routine(r, KIM, null);
  expect(await claim(bare, at(scene, 0), null)).toMatchObject({ reason: 'delegation_required' });
  const delegationId = await delegate(r, KIM, scene.harnessId);
  const runner = await routine(r, KIM, delegationId);
  const unnamed = await claim(runner, at(scene, 0), null);
  expect(unnamed).toMatchObject({
    reason: 'not_permitted',
    detail: { why: 'delegation_mismatch' },
  });
  const before = (await itemLog(r, scene, at(scene, 0))).length;
  expect(await claim(runner, at(scene, 0), delegationId)).toMatchObject({ itemId: at(scene, 0) });
  expect(await step(runner, at(scene, 0))).toMatchObject({ leaseWarning: false });
  expect(await submit(runner, at(scene, 0))).toMatchObject({ result: 'advanced' });
  const written = (await itemLog(r, scene, at(scene, 0))).slice(before);
  expect(written.map((event) => event.name)).toEqual(
    expect.arrayContaining(['item_claimed', 'run_step_recorded']),
  );
  expect(new Set(written.map((event) => event.actor))).toEqual(
    new Set([routineIdentity(KIM, delegationId)]),
  );
}

async function stopsWhenRevoked(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-revoked', 1);
  const { delegationId, runner } = await claimedLive(r, scene, 0);
  await revoke(r, KIM, delegationId);
  const lapsed = {
    status: 'error',
    reason: 'delegation_lapsed',
    detail: { delegationId, why: 'revoked' },
  };
  const revokedBy = [['revoked', routineIdentity(KIM, delegationId)]];
  expect(await step(runner, at(scene, 0))).toEqual(lapsed);
  expect(await lapses(r, scene, delegationId)).toEqual(revokedBy);
  expect(await submit(runner, at(scene, 0))).toEqual(lapsed);
  expect(await lapses(r, scene, delegationId)).toEqual(revokedBy);
  const item = value(await r.kernel.reads.item(caller(r.ian), { itemId: at(scene, 0) })).item;
  expect(item.stageKey).toBe('package');
}

async function stopsWhenAdminIsLost(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-admin-lost', 1);
  const delegationId = await delegate(r, LEE, scene.harnessId);
  const runner = await routine(r, LEE, delegationId);
  expect(await claim(runner, at(scene, 0), delegationId)).toMatchObject({ itemId: at(scene, 0) });
  await revokeSeededGrant(r.db, LEE.adminGrant, r.clock.now());
  const lostBy = [['grant_lost', routineIdentity(LEE, delegationId)]];
  expect(await step(runner, at(scene, 0))).toEqual({
    status: 'error',
    reason: 'delegation_lapsed',
    detail: { delegationId, why: 'grant_lost' },
  });
  expect(await lapses(r, scene, delegationId)).toEqual(lostBy);
  const row = await platformStore(r.db).transaction((tx) => tx.delegations.read.byId(delegationId));
  expect(row?.lapsedAt).toEqual(r.clock.now());
  expect(await submit(runner, at(scene, 0))).toMatchObject({ reason: 'delegation_lapsed' });
  expect(await lapses(r, scene, delegationId)).toEqual(lostBy);
}

async function lapsesOnceUnderRace(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-race', 1);
  const { delegationId } = await claimedLive(r, scene, 0);
  const first = await routine(r, KIM, delegationId);
  const second = await routine(r, KIM, delegationId, r.second);
  await revoke(r, KIM, delegationId);
  const replies = await Promise.all([step(first, at(scene, 0)), step(second, at(scene, 0))]);
  const lapsed = {
    status: 'error',
    reason: 'delegation_lapsed',
    detail: { delegationId, why: 'revoked' },
  };
  expect(replies).toEqual([lapsed, lapsed]);
  expect(await lapses(r, scene, delegationId)).toEqual([
    ['revoked', routineIdentity(KIM, delegationId)],
  ]);
}

async function refusesAnotherPersonsDelegation(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-foreign', 1);
  const foreign = await delegate(r, ADA, scene.harnessId);
  const borrowed = await claim(await routine(r, KIM, foreign), at(scene, 0), foreign);
  const absent = await claim(await routine(r, KIM, MISSING), at(scene, 0), MISSING);
  expect(borrowed).toEqual({
    status: 'error',
    reason: 'delegation_not_found',
    detail: { delegationId: foreign },
  });
  expect(JSON.stringify(borrowed)).toBe(JSON.stringify(absent).replace(MISSING, foreign));
  const item = value(await r.kernel.reads.item(caller(r.ian), { itemId: at(scene, 0) })).item;
  expect(item.holder).toBeNull();
}

describe.skipIf(!testServer)(
  'AB-6 a routine on a service token works only under a live delegation, and names it on every event',
  () => {
    it(
      'claims, steps and submits only under its delegation, as <device> as <persona> via delegation:<id>',
      runsUnderItsDelegation,
    );
    it('stops with one delegation_lapsed when the delegation is revoked mid-run', stopsWhenRevoked);
    it(
      'stops with one delegation_lapsed and lapses the delegation when the owner loses admin',
      stopsWhenAdminIsLost,
    );
    it(
      'writes one delegation_lapsed when two connections step under a revoked delegation',
      lapsesOnceUnderRace,
    );
    it(
      "refuses another person's delegation as delegation_not_found, alike to a missing one",
      refusesAnotherPersonsDelegation,
    );
  },
);

async function loginMustPresentItsDelegation(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-login', 1);
  const named = await delegate(r, KIM, scene.harnessId);
  const other = await delegate(r, KIM, scene.harnessId);
  const laptop = await login(r, KIM, named);
  expect(await claim(laptop, at(scene, 0), null)).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { delegationId: null, why: 'delegation_mismatch' },
  });
  expect(await claim(laptop, at(scene, 0), other)).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { delegationId: other, why: 'delegation_mismatch' },
  });
  const names = (await itemLog(r, scene, at(scene, 0))).map((event) => event.name);
  expect(names).not.toContain('item_claimed');
  expect(await claim(laptop, at(scene, 0), named)).toMatchObject({ itemId: at(scene, 0) });
  const [claimed] = (await itemLog(r, scene, at(scene, 0))).filter(
    (e) => e.name === 'item_claimed',
  );
  expect(claimed?.actor).toBe(delegatedIdentity(`agent:${KIM.id}/laptop`, 'iterate', named));
}

describe.skipIf(!testServer)(
  'AB-6 an interactive login that names a delegation must present it',
  () => {
    it(
      'refuses a claim with no delegation or another live one, not_permitted',
      loginMustPresentItsDelegation,
    );
  },
);

function polled(reply: Body): unknown[] {
  const items = reply['items'];
  return Array.isArray(items) ? items.map((item: Body) => item['itemId']) : [];
}

async function pollsOnlyItsDelegation(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-poll', 1);
  await sceneOf(r, 'delegated-poll-other', 1);
  const live = await routine(r, KIM, await delegate(r, KIM, scene.harnessId));
  expect(polled(await body(live, 'poll_queue', { harnessId: null, limit: 10 }))).toEqual([
    at(scene, 0),
  ]);
  const idle = await routine(r, KIM, await delegate(r, KIM, scene.harnessId, 'none'));
  expect(await body(idle, 'poll_queue', { harnessId: null, limit: 10 })).toEqual({ items: [] });
}

async function pollsNothingWhenRevoked(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-poll-revoked', 1);
  const delegationId = await delegate(r, KIM, scene.harnessId);
  const runner = await routine(r, KIM, delegationId);
  await revoke(r, KIM, delegationId);
  expect(await body(runner, 'poll_queue', { harnessId: null, limit: 10 })).toEqual({
    status: 'error',
    reason: 'delegation_lapsed',
    detail: { delegationId, why: 'revoked' },
  });
}

describe.skipIf(!testServer)(
  'AB-4 a delegated runner polls only what its delegation may act on',
  () => {
    it('polls its own harness, and nothing under capability none', pollsOnlyItsDelegation);
    it('polls nothing under a revoked delegation', pollsNothingWhenRevoked);
  },
);

async function hidesAnotherHarness(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-hidden', 1);
  const elsewhere = await sceneOf(r, 'delegated-hidden-other', 1);
  const live = await routine(r, KIM, await delegate(r, KIM, scene.harnessId));
  const outside = await claim(live, at(elsewhere, 0), null);
  const missing = await claim(live, MISSING, null);
  expect(outside).toEqual({
    status: 'error',
    reason: 'item_not_found',
    detail: { itemId: at(elsewhere, 0) },
  });
  expect(JSON.stringify(outside)).toBe(JSON.stringify(missing).replace(MISSING, at(elsewhere, 0)));
}

async function revokedReadsNothing(): Promise<void> {
  const r = await rig();
  const scene = await sceneOf(r, 'delegated-reads', 1);
  const delegationId = await delegate(r, KIM, scene.harnessId);
  const runner = await routine(r, KIM, delegationId);
  await revoke(r, KIM, delegationId);
  const kim = await personOn(r.db, KIM.id, KIM.email, r.clock.now());
  const minted = principalSchema.parse({
    ...kim,
    identity: routineIdentity(KIM, delegationId),
    kind: 'agent',
    email: null,
    interactive: false,
  });
  const harness = await r.kernel.reads.harness(caller(minted), { harnessId: scene.harnessId });
  expect(harness).toEqual({
    status: 'error',
    reason: 'harness_not_found',
    detail: { harnessId: scene.harnessId },
  });
  const item = await r.kernel.reads.item(caller(minted), { itemId: at(scene, 0) });
  expect(item).toEqual({
    status: 'error',
    reason: 'item_not_found',
    detail: { itemId: at(scene, 0) },
  });
  const hidden = await claim(runner, at(scene, 0), delegationId);
  const absent = await claim(runner, MISSING, delegationId);
  expect(JSON.stringify(hidden)).toBe(JSON.stringify(absent));
}

describe.skipIf(!testServer)(
  'AB-3 a delegated runner is answered alike for an item it cannot read and a missing one',
  () => {
    it('hides an item on another harness as a missing one', hidesAnotherHarness);
    it(
      'reads no scene under a revoked delegation, and answers hidden and missing claims alike',
      revokedReadsNothing,
    );
  },
);
