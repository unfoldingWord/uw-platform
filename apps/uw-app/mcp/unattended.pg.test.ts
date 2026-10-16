import { defaultCiChecks } from '@uw/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { bindServiceToken } from '../agents/service-tokens.ts';
import { createApp } from '../app.tsx';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = {
  id: '00000000-0000-4000-8000-000000001951',
  email: 'unattended-owner@unfoldingword.org',
};
const CLIENT = 'unattended-routine.access';
const MISSING = '00000000-0000-4000-8000-000000001999';

type Body = Record<string, unknown>;
type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly owner: Principal;
  readonly drop: () => Promise<void>;
};
type Scene = {
  readonly harnessId: string;
  readonly otherHarness: string;
  readonly itemId: string;
  readonly delegationId: string;
};

let rigged: Promise<Rig> | null = null;
let scenes = 0;

function grantRow(n: number, role: 'admin' | 'editor') {
  const id = `00000000-0000-4000-8000-00000000195${n}`;
  return { id, personId: OWNER.id, role, scopeKind: 'jd_area' as const, scopeArea: '80-89' };
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  const at = new Date();
  await seedPerson(db, OWNER);
  for (const [n, role] of [[2, 'admin'] as const, [3, 'editor'] as const]) {
    await seedGrant(db, { ...grantRow(n, role), grantedAt: new Date(0), expiresAt: null });
  }
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', at);
  const owner = await personOn(db, OWNER.id, OWNER.email, at);
  const bind = { command: 'bind_service_token' as const, requestId: crypto.randomUUID() };
  const binding = { ...bind, clientId: CLIENT, personId: OWNER.id, device: 'hourly-routine' };
  expect(await bindServiceToken(db, ian, binding, crypto.randomUUID(), at)).toEqual({ ok: true });
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  const fixture = await createAccessFixture();
  return { db, fixture, kernel: kernelOn(db, { now: () => new Date() }), ian, owner, drop };
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

async function harnessIn(r: Rig, key: string): Promise<string> {
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
  return harnessId;
}

async function openScene(r: Rig): Promise<Scene> {
  scenes += 1;
  const harnessId = await harnessIn(r, `software-unattended-${scenes}`);
  const otherHarness = await harnessIn(r, `software-unattended-other-${scenes}`);
  const input = { harnessId, title: 'unattended', pageId: null, priority: 1, due: null };
  const enqueued = await r.kernel.items.enqueue(caller(r.ian), { ...input, delegationId: null });
  const grant = { harnessId, persona: 'agent:iterate', capability: 'iterate' as const };
  const delegation = await r.kernel.delegations.grant(caller(r.owner), {
    ...grant,
    expiresAt: null,
    supersedes: null,
  });
  return {
    harnessId,
    otherHarness,
    itemId: value(enqueued).itemId,
    delegationId: value(delegation).id,
  };
}

async function client(r: Rig, headers: Record<string, string>): Promise<Client> {
  const app = createApp(postgresDeps(r.db, r.fixture));
  return httpClient(app, headers);
}

async function routine(r: Rig, delegationId: string | null): Promise<Client> {
  const token = await r.fixture.signForMcp({ common_name: CLIENT });
  const delegated =
    delegationId === null ? {} : { 'x-uw-persona': 'iterate', 'x-uw-delegation': delegationId };
  return client(r, { 'cf-access-jwt-assertion': token, ...delegated });
}

async function laptop(r: Rig): Promise<Client> {
  const token = await r.fixture.signForMcp({ email: OWNER.email });
  return client(r, { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' });
}

async function text(runner: Client, name: string, args: Body): Promise<string> {
  return JSON.stringify((await callTool(runner, name, args)).body);
}

async function answersAsMissing(runner: Client, name: string, key: string, id: string) {
  const shown = await text(runner, name, { [key]: id });
  const missing = await text(runner, name, { [key]: MISSING });
  expect(missing).toContain('_not_found');
  expect(shown).toBe(missing.replace(MISSING, id));
}

async function isAccepted(runner: Client, name: string, args: Body): Promise<boolean> {
  return !(await callTool(runner, name, args)).isError;
}

const itemVerbs: readonly (readonly [string, (itemId: string) => Body])[] = [
  ['claim_item', (itemId) => ({ itemId, delegationId: null })],
  [
    'submit_to_gate',
    (itemId) => ({ itemId, evidence: {}, to: null, pullRequest: null, head: null }),
  ],
  [
    'record_run_step',
    (itemId) => ({
      itemId,
      runId: '00000000-0000-4000-8000-000000001960',
      step: 'work',
      tokensIn: 1,
      tokensOut: 1,
      costBasis: 'subscription',
    }),
  ],
];

async function undelegatedSeesNothing(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const runner = await routine(r, null);
  await answersAsMissing(runner, 'get_health', 'harnessId', scene.harnessId);
  await answersAsMissing(runner, 'resolve_context', 'itemId', scene.itemId);
  for (const [name, args] of itemVerbs) {
    const existing = await text(runner, name, args(scene.itemId));
    expect(existing).toContain('delegation_required');
    expect(existing).toBe(await text(runner, name, args(MISSING)));
  }
  await runner.close();
}

async function delegatedSeesItsHarness(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const runner = await routine(r, scene.delegationId);
  expect(await isAccepted(runner, 'get_health', { harnessId: scene.harnessId })).toBe(true);
  expect(await isAccepted(runner, 'resolve_context', { itemId: scene.itemId })).toBe(true);
  await answersAsMissing(runner, 'get_health', 'harnessId', scene.otherHarness);
  await runner.close();
}

async function laptopUnchanged(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const device = await laptop(r);
  for (const harnessId of [scene.harnessId, scene.otherHarness]) {
    expect(await isAccepted(device, 'get_health', { harnessId })).toBe(true);
  }
  expect(await isAccepted(device, 'resolve_context', { itemId: scene.itemId })).toBe(true);
  await device.close();
}

describe.skipIf(!testServer)(
  'AB-4 an unattended runner without a delegation sees no harness, item or stage',
  () => {
    it(
      'answers get_health, resolve_context and every item verb exactly as for a missing id',
      undelegatedSeesNothing,
    );
    it('reads its delegated harness once it names a live delegation', delegatedSeesItsHarness);
    it('leaves an interactive device reading every harness its owner may read', laptopUnchanged);
  },
);
