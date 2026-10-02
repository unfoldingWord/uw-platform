import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { principalSchema, refusalSchema, type HarnessEvent, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { LEASE_MS, readAllEvents, software, type Caller, type Kernel } from '@uw/harness';
import { bindServiceToken } from '../agents/service-tokens.ts';
import { createApp } from '../app.tsx';
import { platformStore } from '../ports/store.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, noFacts, personOn } from '../testing/kernel.ts';
import { areaGrant, callTool, httpClient, testAgent } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import type { VerbContext } from './context.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const EDITOR = {
  id: '00000000-0000-4000-8000-000000001301',
  email: 'verbs-editor@unfoldingword.org',
};
const LEAVER = {
  id: '00000000-0000-4000-8000-000000001303',
  email: 'verbs-leaver@unfoldingword.org',
};
const LEAVER_80 = '00000000-0000-4000-8000-000000001304';
const CLIENT = 'verbs-routine.access';
const ROUTINE = 'hourly-routine';
const MINUTE = 60_000;
const HEAD = 'a'.repeat(40);

type Body = Record<string, unknown>;
type SettableClock = { now(): Date; advance(milliseconds: number): void };
type Rig = {
  readonly db: Database;
  readonly clock: SettableClock;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly editor: Principal;
  readonly drop: () => Promise<void>;
};
type Harness = { readonly harnessId: string; readonly itemIds: readonly string[] };

const seen: Body[] = [];
let rigged: Promise<Rig> | null = null;

function settableClock(): SettableClock {
  let current = Date.now();
  return { now: () => new Date(current), advance: (ms) => void (current += ms) };
}

function editorGrant(id: string, personId: string, area: string) {
  const grantedAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    personId,
    role: 'editor' as const,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt,
    expiresAt: null,
  };
}

async function seedPeople(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, editorGrant('00000000-0000-4000-8000-000000001302', EDITOR.id, '80-89'));
  await seedPerson(db, LEAVER);
  await seedGrant(db, editorGrant(LEAVER_80, LEAVER.id, '80-89'));
  await seedGrant(db, editorGrant('00000000-0000-4000-8000-000000001305', LEAVER.id, '20-29'));
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  const clock = settableClock();
  await seedPeople(db);
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', clock.now());
  const editor = await personOn(db, EDITOR.id, EDITOR.email, clock.now());
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  const fixture = await createAccessFixture();
  const kernel = kernelOn(db, clock, { githubFacts: noFacts });
  return { db, clock, fixture, kernel, ian, editor, drop };
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

function repositoryOf(key: string): string {
  return `unfoldingWord/${key}`;
}

function pullRequestOf(key: string) {
  return { repo: repositoryOf(key), number: 7 };
}

async function harnessWith(r: Rig, key: string, priorities: readonly number[], area = '80-89') {
  const harnessId = crypto.randomUUID();
  const template = software;
  value(
    await r.kernel.stages.activate(caller(r.ian), {
      harnessId,
      harnessKey: key,
      jdArea: area,
      template,
      repository: repositoryOf(key),
    }),
  );
  const change = { agentPickup: 'allowed' as const };
  value(
    await r.kernel.stages.updateStage(caller(r.ian), { harnessId, stageKey: 'package', change }),
  );
  const itemIds: string[] = [];
  for (const [n, priority] of priorities.entries()) {
    const input = { harnessId, title: `${key} ${n}`, pageId: null, priority, due: null };
    itemIds.push(
      value(await r.kernel.items.enqueue(caller(r.ian), { ...input, delegationId: null })).itemId,
    );
  }
  return { harnessId, itemIds };
}

async function runner(r: Rig, device: string, email = EDITOR.email): Promise<Client> {
  const token = await r.fixture.signForMcp({ email });
  const app = createApp(postgresDeps(r.db, r.fixture, undefined, r.clock));
  return httpClient(app, { 'cf-access-jwt-assertion': token, 'x-uw-device': device });
}

async function routineRunner(r: Rig): Promise<Client> {
  const command = {
    command: 'bind_service_token' as const,
    requestId: crypto.randomUUID(),
    clientId: CLIENT,
    personId: EDITOR.id,
    device: ROUTINE,
  };
  expect(await bindServiceToken(r.db, r.ian, command, crypto.randomUUID(), r.clock.now())).toEqual({
    ok: true,
  });
  const token = await r.fixture.signForMcp({ common_name: CLIENT });
  const app = createApp(postgresDeps(r.db, r.fixture, undefined, r.clock));
  return httpClient(app, { 'cf-access-jwt-assertion': token });
}

async function call(client: Client, name: string, args: Body) {
  const result = await callTool(client, name, args);
  if (result.isError) seen.push(result.body);
  return result;
}

function claim(client: Client, itemId: string) {
  return call(client, 'claim_item', { itemId, delegationId: null });
}

function step(client: Client, itemId: string, costBasis: string) {
  const run = { runId: '00000000-0000-4000-8000-000000001310', step: 'work' };
  return call(client, 'record_run_step', {
    itemId,
    ...run,
    tokensIn: 120,
    tokensOut: 30,
    costBasis,
  });
}

async function eventsNamed(r: Rig, h: Harness, name: string): Promise<HarnessEvent[]> {
  const all = await platformStore(r.db).transaction((tx) => readAllEvents(tx, h.harnessId, null));
  return all.filter((event) => event.name === name);
}

function polledIds(body: Body): unknown[] {
  const items = body['items'];
  return Array.isArray(items) ? items.map((item: Body) => item['itemId']) : [];
}

function at(h: Harness, n: number): string {
  const itemId = h.itemIds[n];
  if (itemId === undefined) throw new Error(`no item ${n}`);
  return itemId;
}

function untilExpiry(body: Body, r: Rig): number {
  return Date.parse(String(body['leaseExpiresAt'])) - r.clock.now().getTime();
}

describe.skipIf(!testServer)('AB-4 poll_queue lists what the runner may claim', () => {
  it('lists the items in priority order, and drops the one the runner claims', async () => {
    const r = await rig();
    const h = await harnessWith(r, 'software-poll', [1, 3, 2]);
    const laptop = await runner(r, 'laptop');
    const before = await call(laptop, 'poll_queue', { harnessId: h.harnessId, limit: 10 });
    expect(polledIds(before.body)).toEqual([at(h, 1), at(h, 2), at(h, 0)]);
    expect((await claim(laptop, at(h, 1))).isError).toBe(false);
    const after = await call(laptop, 'poll_queue', { harnessId: null, limit: 10 });
    expect(polledIds(after.body)).toEqual([at(h, 2), at(h, 0)]);
  });
});

describe.skipIf(!testServer)('AB-4 claim_item takes a lease and records the agent', () => {
  it('leases for 15 minutes and records the claim as agent:<person>/laptop', async () => {
    const r = await rig();
    const h = await harnessWith(r, 'software-claim', [1, 1]);
    const claimed = await claim(await runner(r, 'laptop'), at(h, 0));
    expect(claimed.isError).toBe(false);
    expect(claimed.body).toMatchObject({ itemId: at(h, 0), leaseWarning: false });
    expect(untilExpiry(claimed.body, r)).toBe(LEASE_MS);
    const [event] = await eventsNamed(r, h, 'item_claimed');
    expect(event?.actor).toBe(`agent:${EDITOR.id}/laptop`);
    const second = await claim(await runner(r, 'desktop'), at(h, 0));
    expect(second.body['reason']).toBe('lease_held');
    const routine = await claim(await routineRunner(r), at(h, 1));
    expect(routine.body['reason']).toBe('delegation_required');
  });

  it('answers an item the runner cannot read byte for byte as a missing one', async () => {
    const r = await rig();
    const h = await harnessWith(r, 'software-hidden', [1]);
    const missingId = '00000000-0000-4000-8000-000000001399';
    const missing = await claim(await runner(r, 'laptop'), missingId);
    expect(missing.body).toEqual({
      status: 'error',
      reason: 'item_not_found',
      detail: { itemId: missingId },
    });
    const outsider = workflowContext(r, testAgent([areaGrant('viewer', '20-29')]));
    for (const [name, args] of Object.entries(gatedArgs)) {
      const hidden = textOf(await callVerb(outsider, name, args(at(h, 0)), verbHandlers));
      const absent = textOf(await callVerb(outsider, name, args(missingId), verbHandlers));
      expect(absent).toContain('item_not_found');
      expect(hidden).toBe(absent.replace(missingId, at(h, 0)));
    }
  });
});

const gatedArgs: Record<string, (itemId: string) => Body> = {
  claim_item: (itemId) => ({ itemId, delegationId: null }),
  submit_to_gate: (itemId) => ({ itemId, evidence: {}, to: null, pullRequest: null, head: null }),
  record_run_step: (itemId) => ({
    itemId,
    runId: crypto.randomUUID(),
    step: 'read',
    tokensIn: 0,
    tokensOut: 0,
    costBasis: 'metered',
  }),
};

async function stepsOverHttp(): Promise<void> {
  const r = await rig();
  const h = await harnessWith(r, 'software-step', [1]);
  const laptop = await runner(r, 'laptop');
  const claimed = await claim(laptop, at(h, 0));
  r.clock.advance(MINUTE);
  const recorded = await step(laptop, at(h, 0), 'subscription');
  expect(recorded.body).toEqual({ leaseExpiresAt: expect.any(String), leaseWarning: false });
  expect(Date.parse(String(recorded.body['leaseExpiresAt']))).toBeGreaterThan(
    Date.parse(String(claimed.body['leaseExpiresAt'])),
  );
  const [event] = await eventsNamed(r, h, 'run_step_recorded');
  expect(event?.actor).toBe(`agent:${EDITOR.id}/laptop`);
  expect(event?.evidence).toMatchObject({
    tokensIn: 120,
    tokensOut: 30,
    costBasis: 'subscription',
  });
  const metered = await step(laptop, at(h, 0), 'metered');
  expect(metered.body).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'cost_basis_is_the_hosts', expected: 'subscription' },
  });
  r.clock.advance(12 * MINUTE);
  expect((await step(laptop, at(h, 0), 'subscription')).body['leaseWarning']).toBe(true);
  r.clock.advance(16 * MINUTE);
  expect((await step(laptop, at(h, 0), 'subscription')).body['reason']).toBe('lease_expired');
}

async function stepsInProcess(): Promise<void> {
  const r = await rig();
  const h = await harnessWith(r, 'software-workflow', [1]);
  expect((await claim(await runner(r, 'laptop'), at(h, 0))).isError).toBe(false);
  const device = workflowContext(r, devicePrincipal(r.editor));
  const args = (costBasis: string) => ({ ...gatedArgs['record_run_step']?.(at(h, 0)), costBasis });
  const wrong = await callVerb(device, 'record_run_step', args('subscription'), verbHandlers);
  expect(JSON.parse(textOf(wrong))).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'cost_basis_is_the_hosts', expected: 'metered' },
  });
  const right = await callVerb(device, 'record_run_step', args('metered'), verbHandlers);
  expect(right.isError).toBeUndefined();
  const [event] = await eventsNamed(r, h, 'run_step_recorded');
  expect(event?.evidence).toMatchObject({ costBasis: 'metered' });
}

describe.skipIf(!testServer)(
  'AB-4 record_run_step renews the lease, reports tokens by host, and refuses an expired lease',
  () => {
    it('records the step with the subscription basis and warns near expiry', stepsOverHttp);
    it('takes metered, not subscription, from a step reported in process', stepsInProcess);
  },
);

function devicePrincipal(owner: Principal): Principal {
  return principalSchema.parse({
    ...owner,
    identity: `agent:${EDITOR.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

function workflowContext(r: Rig, principal: Principal): VerbContext {
  return {
    principal,
    host: 'workflow',
    at: r.clock.now(),
    traceId: crypto.randomUUID(),
    kernel: r.kernel,
    db: r.db,
    commit: 'test-commit',
    logger: createLogger(
      { traceId: 'trace', commit: 'test-commit', route: 'workflow', principal: null },
      () => undefined,
    ),
  };
}

function textOf(result: Awaited<ReturnType<typeof callVerb>>): string {
  const [block] = result.content;
  return block?.type === 'text' ? block.text : '{}';
}

async function heldByPersonAtCheck(
  r: Rig,
  key: string,
): Promise<{ readonly h: Harness; readonly itemId: string }> {
  const h = await harnessWith(r, key, [1]);
  const change = { exitGate: 'human_approval' as const };
  value(
    await r.kernel.stages.updateStage(caller(r.ian), {
      harnessId: h.harnessId,
      stageKey: 'check',
      change,
    }),
  );
  const itemId = at(h, 0);
  for (const stageKey of ['package', 'scope', 'plan', 'build']) {
    expect(value(await r.kernel.reads.item(caller(r.ian), { itemId })).item.stageKey).toBe(
      stageKey,
    );
    value(await r.kernel.items.claim(caller(r.editor), { itemId, delegationId: null }));
    value(
      await r.kernel.items.submit(caller(r.editor), {
        itemId,
        to: null,
        evidence: {},
        change: null,
      }),
    );
  }
  return { h, itemId };
}

describe.skipIf(!testServer)('AB-4 submit_to_gate parks at a human gate', () => {
  it('parks the runner submission with its pull request, and the item stays at check', async () => {
    const r = await rig();
    const { h, itemId } = await heldByPersonAtCheck(r, 'software-gate');
    const laptop = await runner(r, 'laptop');
    expect((await claim(laptop, itemId)).isError).toBe(false);
    const submitted = await submitInProcess(r, {
      ...submission(itemId, 'software-gate', null),
      evidence: { summary: 'ready for a person' },
    });
    expect(submitted).toEqual({ itemId, result: 'parked', failures: [] });
    const item = value(await r.kernel.reads.item(caller(r.ian), { itemId })).item;
    expect(item).toMatchObject({ stageKey: 'check', gateStatus: 'parked' });
    expect(await eventsNamed(r, h, 'risk_derived')).toEqual([]);
    const [parked] = await eventsNamed(r, h, 'submitted_to_gate').then((all) => all.slice(-1));
    expect(parked?.actor).toBe(`agent:${EDITOR.id}/laptop`);
    expect(parked?.evidence).toMatchObject({
      pullRequest: pullRequestOf('software-gate'),
      expectedHead: HEAD,
    });
  });
});

function submission(itemId: string, key: string, to: string | null): Body {
  return { itemId, evidence: {}, to, pullRequest: pullRequestOf(key), head: HEAD };
}

function unchanged(itemId: string): Body {
  return { itemId, evidence: {}, to: null, pullRequest: null, head: null };
}

async function submitInProcess(r: Rig, args: Body): Promise<Body> {
  const context = { ...workflowContext(r, devicePrincipal(r.editor)), host: 'external' as const };
  return JSON.parse(textOf(await callVerb(context, 'submit_to_gate', args, verbHandlers)));
}

describe.skipIf(!testServer)('AB-4 submit_to_gate names no stage past a human gate', () => {
  it('parks a submission that names ship with a pull request, and the item stays at check', async () => {
    const r = await rig();
    const { itemId } = await heldByPersonAtCheck(r, 'software-gate-ship');
    const laptop = await runner(r, 'laptop');
    expect((await claim(laptop, itemId)).isError).toBe(false);
    const submitted = await submitInProcess(r, submission(itemId, 'software-gate-ship', 'ship'));
    expect(submitted).toEqual({ itemId, result: 'parked', failures: [] });
    const item = value(await r.kernel.reads.item(caller(r.ian), { itemId })).item;
    expect(item).toMatchObject({ stageKey: 'check', gateStatus: 'parked' });
  });
});

describe.skipIf(!testServer)('AB-4 submit_to_gate refuses a lapsed lease', () => {
  it('answers lease_expired once the lease has lapsed, and the item does not move', async () => {
    const r = await rig();
    const h = await harnessWith(r, 'software-lapsed', [1]);
    const laptop = await runner(r, 'laptop');
    expect((await claim(laptop, at(h, 0))).isError).toBe(false);
    r.clock.advance(LEASE_MS + MINUTE);
    const submitted = await call(laptop, 'submit_to_gate', unchanged(at(h, 0)));
    expect(submitted.body).toMatchObject({ reason: 'lease_expired', detail: { itemId: at(h, 0) } });
    const item = value(await r.kernel.reads.item(caller(r.ian), { itemId: at(h, 0) })).item;
    expect(item.stageKey).toBe('package');
  });
});

describe.skipIf(!testServer)(
  'AB-4 a grant the owner loses stops the runner on its next call',
  () => {
    it('refuses the next claim on the area once the owner loses editor there', async () => {
      const r = await rig();
      const h = await harnessWith(r, 'software-revoked', [1, 1]);
      const laptop = await runner(r, 'laptop', LEAVER.email);
      expect((await claim(laptop, at(h, 0))).isError).toBe(false);
      await revokeSeededGrant(r.db, LEAVER_80, r.clock.now());
      const refused = await claim(laptop, at(h, 1));
      expect(refused.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const item = value(await r.kernel.reads.item(caller(r.ian), { itemId: at(h, 1) })).item;
      expect(item.holder).toBeNull();
    });
  },
);

const surfaceRefusal = refusalSchema.extend({ detail: z.record(z.string(), z.json()) }).strict();

describe.skipIf(!testServer)(
  'AB-4 every refusal through the surface is a closed-set reason',
  () => {
    it('parses its own refusals and every error body this file saw with the refusal schema', async () => {
      const r = await rig();
      const laptop = await runner(r, 'laptop');
      const missingId = '00000000-0000-4000-8000-000000001398';
      const own = [
        await claim(laptop, missingId),
        await step(laptop, missingId, 'metered'),
        await call(laptop, 'submit_to_gate', unchanged(missingId)),
      ];
      expect(own.every((result) => result.isError)).toBe(true);
      for (const body of seen) expect(surfaceRefusal.safeParse(body).success).toBe(true);
      expect(own.map((result) => surfaceRefusal.parse(result.body).reason)).toEqual([
        'item_not_found',
        'item_not_found',
        'item_not_found',
      ]);
    });
  },
);
