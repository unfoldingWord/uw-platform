import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CONTRACT_VERSION,
  defaultCiChecks,
  delegatedIdentity,
  type HarnessEvent,
  type Principal,
} from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedActivePersona, seedGrant, seedPerson } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { platformStore } from '../ports/store.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { listForDispatch } from '../testing/dispatch.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import { applyRoutineChange } from './routine-actions.ts';
import { bindOwnRoutine, noteRoutineSeen, routinesOnHarness } from './routines.ts';

const ROWAN_ID = '00000000-0000-4000-8000-000000000001';
const DEVICE = 'hourly-box';

type Person = { readonly id: string; readonly email: string; readonly role: 'admin' | 'editor' };

const KIM: Person = {
  id: '00000000-0000-4000-8000-000000002401',
  email: 'routine-kim@unfoldingword.org',
  role: 'admin',
};
const LEE: Person = {
  id: '00000000-0000-4000-8000-000000002402',
  email: 'routine-lee@unfoldingword.org',
  role: 'admin',
};
const EDDIE: Person = {
  id: '00000000-0000-4000-8000-000000002403',
  email: 'routine-eddie@unfoldingword.org',
  role: 'editor',
};

type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly rowan: Principal;
  readonly drop: () => Promise<void>;
};
type Scene = { readonly harnessId: string; readonly itemId: string; readonly kim: Principal };

let rigged: Promise<Rig> | null = null;
let scenes = 0;

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  for (const person of [KIM, LEE, EDDIE]) {
    await seedPerson(db, { id: person.id, email: person.email });
    await seedGrant(db, {
      id: crypto.randomUUID(),
      personId: person.id,
      role: person.role,
      scopeKind: 'jd_area',
      scopeArea: '80-89',
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
    });
  }
  const rowan = await personOn(db, ROWAN_ID, 'rowan.test@unfoldingword.org', new Date());
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  const fixture = await createAccessFixture();
  return { db, fixture, kernel: kernelOn(db, { now: () => new Date() }), rowan, drop };
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

function person(r: Rig, who: Person): Promise<Principal> {
  return personOn(r.db, who.id, who.email, new Date());
}

async function openScene(r: Rig): Promise<Scene> {
  scenes += 1;
  const harnessId = crypto.randomUUID();
  const key = `software-routine-${scenes.toString()}`;
  const activate = {
    harnessId,
    harnessKey: key,
    jdArea: '80-89',
    template: software,
    repository: `unfoldingWord/${key}`,
    requiredChecks: [...defaultCiChecks],
  };
  value(await r.kernel.stages.activate(caller(r.rowan), activate));
  await listForDispatch(r.db, activate.repository);
  const change = { agentPickup: 'allowed' as const, bracket: 'iterate' as const };
  value(
    await r.kernel.stages.updateStage(caller(r.rowan), { harnessId, stageKey: 'package', change }),
  );
  const input = { harnessId, title: 'routine item', pageId: null, priority: 1, due: null };
  const enqueued = await r.kernel.items.enqueue(caller(r.rowan), { ...input, delegationId: null });
  await seedActivePersona(r.db, {
    identity: 'agent:iterate',
    harnessId,
    frontmatter: { capability: 'iterate' },
  });
  return { harnessId, itemId: value(enqueued).itemId, kim: await person(r, KIM) };
}

async function grant(r: Rig, harnessId: string, actor: Principal): Promise<string> {
  const input = { harnessId, persona: 'agent:iterate', expiresAt: null, supersedes: null };
  const made = await r.kernel.delegations.grant(caller(actor), {
    ...input,
    capability: 'iterate',
    maxTier: null,
  });
  return value(made).id;
}

type Bound = { readonly routineId: string; readonly clientId: string };

async function bindFor(
  r: Rig,
  actor: Principal,
  harnessId: string,
  delegationId: string,
  device = DEVICE,
) {
  const routineId = crypto.randomUUID();
  const clientId = `routine-${routineId.slice(0, 8)}.access`;
  const setup = {
    harnessId,
    routineId,
    name: 'Hourly iterate',
    device,
    delegationId,
    accessTokenId: `cf-${routineId}`,
    clientId,
  };
  const bound = await bindOwnRoutine(r.db, actor, setup, crypto.randomUUID(), new Date());
  return { bound, routine: { routineId, clientId } satisfies Bound };
}

async function signIn(r: Rig, clientId: string, delegationId: string): Promise<Response> {
  const token = await r.fixture.signForMcp({ common_name: clientId });
  const app = createApp(postgresDeps(r.db, r.fixture));
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'routine-test', version: CONTRACT_VERSION },
    },
  };
  const headers = {
    'cf-access-jwt-assertion': token,
    'x-uw-persona': 'iterate',
    'x-uw-delegation': delegationId,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  return app.request(
    'http://uw.test/mcp',
    { method: 'POST', headers, body: JSON.stringify(initialize) },
    fixtureAccessEnv,
  );
}

async function refusalOf(response: Response): Promise<string | null> {
  if (response.ok) return null;
  const body = (await response.json()) as { reason?: string };
  return body.reason ?? `status ${response.status.toString()}`;
}

async function connect(r: Rig, clientId: string, delegationId: string): Promise<Client> {
  const token = await r.fixture.signForMcp({ common_name: clientId });
  const headers = {
    'cf-access-jwt-assertion': token,
    'x-uw-persona': 'iterate',
    'x-uw-delegation': delegationId,
  };
  return httpClient(createApp(postgresDeps(r.db, r.fixture)), headers);
}

async function logOf(r: Rig, harnessId: string): Promise<readonly HarnessEvent[]> {
  return platformStore(r.db).transaction((tx) => readAllEvents(tx, harnessId, null));
}

function change(
  r: Rig,
  actor: Principal,
  routineId: string,
  name: Parameters<typeof applyRoutineChange>[2],
) {
  const deleted: string[] = [];
  const env = { ACCESS_ACCOUNT_ID: 'account-1', ACCESS_SERVICE_TOKENS_API_TOKEN: 'key-1' };
  const fetcher: typeof fetch = async (input) => {
    deleted.push(String(input));
    return Response.json({ success: true });
  };
  const request = { db: r.db, env, fetch: fetcher, actor, at: new Date() };
  return applyRoutineChange(request, routineId, name).then((outcome) => ({ outcome, deleted }));
}

async function bindingRules(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const delegationId = await grant(r, scene.harnessId, scene.kim);
  const lee = await person(r, LEE);
  const eddie = await person(r, EDDIE);
  expect((await bindFor(r, lee, scene.harnessId, delegationId, 'lee-box')).bound).toEqual({
    ok: false,
    reason: 'delegation_not_found',
  });
  expect((await bindFor(r, eddie, scene.harnessId, delegationId, 'eddie-box')).bound).toEqual({
    ok: false,
    reason: 'delegation_not_found',
  });
  const first = await bindFor(r, scene.kim, scene.harnessId, delegationId, 'kim-box-1');
  expect(first.bound).toMatchObject({
    ok: true,
    grant: { delegationId, persona: 'agent:iterate' },
  });
  expect((await bindFor(r, scene.kim, scene.harnessId, delegationId, 'kim-box-2')).bound).toEqual({
    ok: false,
    reason: 'grant_exists',
  });
  const other = await openScene(r);
  const ended = await grant(r, other.harnessId, scene.kim);
  value(await r.kernel.delegations.revoke(caller(scene.kim), { delegationId: ended }));
  expect((await bindFor(r, scene.kim, other.harnessId, ended, 'kim-box-3')).bound).toEqual({
    ok: false,
    reason: 'delegation_lapsed',
  });
}

async function worksAsItsRoleUntilRevoked(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const delegationId = await grant(r, scene.harnessId, scene.kim);
  const { routine } = await bindFor(r, scene.kim, scene.harnessId, delegationId, 'kim-proof');
  const runner = await connect(r, routine.clientId, delegationId);
  const claimed = await callTool(runner, 'claim_item', { itemId: scene.itemId, delegationId });
  expect(claimed.body).toMatchObject({ itemId: scene.itemId });
  const runId = crypto.randomUUID();
  const step = { itemId: scene.itemId, runId, step: 'work', tokensIn: 50, tokensOut: 10 };
  await callTool(runner, 'record_run_step', { ...step, costBasis: 'subscription' });
  await runner.close();
  const claim = (await logOf(r, scene.harnessId)).find((event) => event.name === 'item_claimed');
  expect(claim?.actor).toBe(
    delegatedIdentity(`agent:${KIM.id}/kim-proof`, 'iterate', delegationId),
  );
  const [listed] = await routinesOnHarness(r.db, scene.harnessId, new Date());
  expect(listed).toMatchObject({ itemsClaimed: 1, tokens: 60, paused: false });
  expect(listed?.lastSeenAt).not.toBeNull();
  const revoked = await change(r, scene.kim, routine.routineId, 'revoke_routine');
  expect(revoked.outcome).toEqual({ ok: true, loginRemoved: true });
  expect(revoked.deleted).toEqual([
    `https://api.cloudflare.com/client/v4/accounts/account-1/access/service_tokens/cf-${routine.routineId}`,
  ]);
  expect(await refusalOf(await signIn(r, routine.clientId, delegationId))).toBe('unauthenticated');
  expect(await routinesOnHarness(r.db, scene.harnessId, new Date())).toEqual([]);
}

async function pausedAndBorrowedAreRefused(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const delegationId = await grant(r, scene.harnessId, scene.kim);
  const { routine } = await bindFor(r, scene.kim, scene.harnessId, delegationId, 'kim-pause');
  expect(await refusalOf(await signIn(r, routine.clientId, delegationId))).toBeNull();
  const borrowed = crypto.randomUUID();
  expect(await refusalOf(await signIn(r, routine.clientId, borrowed))).toBe('not_permitted');
  const lee = await person(r, LEE);
  expect((await change(r, lee, routine.routineId, 'pause_routine')).outcome).toEqual({
    ok: false,
    reason: 'not_permitted',
  });
  expect((await change(r, r.rowan, routine.routineId, 'pause_routine')).outcome).toEqual({
    ok: true,
    loginRemoved: false,
  });
  expect(await refusalOf(await signIn(r, routine.clientId, delegationId))).toBe('not_permitted');
  await change(r, scene.kim, routine.routineId, 'resume_routine');
  expect(await refusalOf(await signIn(r, routine.clientId, delegationId))).toBeNull();
}

async function seenAtMostOncePerMinute(): Promise<void> {
  const r = await rig();
  const scene = await openScene(r);
  const delegationId = await grant(r, scene.harnessId, scene.kim);
  const { routine } = await bindFor(r, scene.kim, scene.harnessId, delegationId, 'kim-seen');
  const first = new Date('2026-11-18T10:00:00.000Z');
  const seen = async () => (await routinesOnHarness(r.db, scene.harnessId, first))[0]?.lastSeenAt;
  await noteRoutineSeen(r.db, routine.routineId, first);
  await noteRoutineSeen(r.db, routine.routineId, new Date(first.getTime() + 30_000));
  expect(await seen()).toEqual(first);
  const later = new Date(first.getTime() + 61_000);
  await noteRoutineSeen(r.db, routine.routineId, later);
  expect(await seen()).toEqual(later);
}

describe.skipIf(!testServer)('#134 a routine works under its owner’s standing permission', () => {
  it('binds only to an area admin’s own live permission, one routine per permission', bindingRules);
  it('claims an item as its role, is counted, and stops at revoke', worksAsItsRoleUntilRevoked);
  it('refuses a paused routine and one presenting another permission', pausedAndBorrowedAreRefused);
  it('writes last seen at most once a minute', seenAtMostOncePerMinute);
});
