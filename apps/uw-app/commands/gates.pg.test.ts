import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { HarnessEvent, ItemState } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { otherHead } from '../github/testing/merge-rig.ts';
import { decisionRows, pulls } from '../github/testing/ship-rig.ts';
import {
  alreadyShipped,
  gateDeps,
  kimEmail,
  kimGrantId,
  kernelThatLosesTheExit,
  mergePath,
  parkedAtShip,
  readyToShip,
  refs,
  shipWrites,
  type ParkedAtShip,
} from '../github/testing/gate-rig.ts';
import type { FixtureGitHub } from '../github/testing/fixture-github.ts';
import {
  allEvents,
  callerOf,
  eventCount,
  itemState,
  post,
  type Sent,
} from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { noGateGitHub, type PersonDeps } from './person-deps.ts';

type Target = { readonly email: string; readonly item: ItemState };

function send(
  db: Database,
  target: Target,
  name: string,
  body: Readonly<Record<string, unknown>>,
  person: PersonDeps = noGateGitHub,
): Promise<Sent> {
  const path = `/api/harness/${target.item.harnessId}/commands/${name}`;
  return post(db, target.email, path, { command: name, ...body }, person);
}

function approval(parked: ParkedAtShip, requestId: string, head: string | null) {
  return { requestId, itemId: parked.item.itemId, head };
}

async function eventsAfter(db: Database, item: ItemState, count: number): Promise<HarnessEvent[]> {
  return (await allEvents(db, item.harnessId)).slice(count);
}

function namesOf(events: readonly HarnessEvent[]): string[] {
  return events.map((event) => event.name);
}

function readsBeforeTheMerge(github: FixtureGitHub): void {
  const sent = github.requests().map((request) => `${request.method} ${request.path}`);
  const merge = sent.indexOf(`PUT ${mergePath}`);
  expect(sent.indexOf(`GET ${pulls}/reviews`)).toBeGreaterThanOrEqual(0);
  expect(sent.indexOf(`GET ${pulls}/reviews`)).toBeLessThan(merge);
  expect(sent.findIndex((line) => line.includes('/check-runs'))).toBeLessThan(merge);
}

async function approveMerges(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const github = readyToShip(parked.item.itemId);
  const before = await eventCount(db, parked.item.harnessId);
  const requestId = randomUUID();
  const body = approval(parked, requestId, parked.item.expectedHead);
  const sent = await send(
    db,
    { email: kimEmail, item: parked.item },
    'approve',
    body,
    await gateDeps(github),
  );
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect(await decisionRows(db, parked.item)).toBe(1);
  const events = await eventsAfter(db, parked.item, before);
  const names = namesOf(events);
  expect(names.indexOf('risk_derived')).toBeGreaterThanOrEqual(0);
  expect(names.indexOf('risk_derived')).toBeLessThan(names.indexOf('gate_approved'));
  expect(names.indexOf('gate_approved')).toBeLessThan(names.indexOf('connector_succeeded'));
  expect(events.every((event) => event.requestId === requestId)).toBe(true);
  expect(shipWrites(github)).toEqual([`PUT ${mergePath}`, `POST ${refs}`]);
  readsBeforeTheMerge(github);
}

async function approveTwice(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const github = readyToShip(parked.item.itemId);
  const person = await gateDeps(github);
  const body = approval(parked, randomUUID(), parked.item.expectedHead);
  const first = await send(db, { email: kimEmail, item: parked.item }, 'approve', body, person);
  const events = await eventCount(db, parked.item.harnessId);
  const second = await send(db, { email: kimEmail, item: parked.item }, 'approve', body, person);
  expect(second.text).toBe(first.text);
  expect(first.body).toMatchObject({ status: 'accepted' });
  expect(await decisionRows(db, parked.item)).toBe(1);
  expect(await eventCount(db, parked.item.harnessId)).toBe(events);
  expect(shipWrites(github)).toEqual([`PUT ${mergePath}`, `POST ${refs}`]);
}

async function otherHeadDecidesNothing(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const github = readyToShip(parked.item.itemId);
  const person = await gateDeps(github);
  const before = await eventCount(db, parked.item.harnessId);
  for (const head of [otherHead, null]) {
    const requestId = randomUUID();
    const sent = await send(
      db,
      { email: kimEmail, item: parked.item },
      'approve',
      approval(parked, requestId, head),
      person,
    );
    expect(sent.body).toEqual({ status: 'error', requestId, reason: 'head_mismatch' });
  }
  expect(await decisionRows(db, parked.item)).toBe(0);
  expect(namesOf(await eventsAfter(db, parked.item, before))).not.toContain('gate_approved');
  expect(shipWrites(github)).toEqual([]);
  expect(await itemState(db, parked.item.itemId)).toMatchObject({ gateStatus: 'parked' });
}

async function noAppIsNotWired(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const requestId = randomUUID();
  const body = approval(parked, requestId, parked.item.expectedHead);
  const sent = await send(db, { email: kimEmail, item: parked.item }, 'approve', body);
  expect(sent.body).toEqual({ status: 'error', requestId, reason: 'not_wired' });
  expect(await decisionRows(db, parked.item)).toBe(0);
  expect(await itemState(db, parked.item.itemId)).toMatchObject({ gateStatus: 'parked' });
}

describe.skipIf(!testServer)('WB-1 a person approves at Ship through the command API', () => {
  it('WB-1 approve at Ship through the command API refreshes GitHub facts, writes one gate decision and merges through the connector', () =>
    withAppDatabase(approveMerges));

  it('WB-1 approving twice with one requestId writes one decision and replays the outcome', () =>
    withAppDatabase(approveTwice));

  it('WB-1 approve naming a head other than the expected one is head_mismatch and decides nothing', () =>
    withAppDatabase(otherHeadDecidesNothing));

  it('WB-1 approve with no GitHub App configured answers not_wired and decides nothing', () =>
    withAppDatabase(noAppIsNotWired));
});

async function rejected(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const requestId = randomUUID();
  const findings = ['The board does not load on a phone'];
  const body = { requestId, itemId: parked.item.itemId, findings };
  const sent = await send(db, { email: kimEmail, item: parked.item }, 'reject', body);
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  const after = await allEvents(db, parked.item.harnessId);
  expect(after.find((event) => event.name === 'gate_rejected')).toMatchObject({
    requestId,
    actor: parked.kim.identity,
    evidence: { stage: 'ship', findings },
  });
  expect(await itemState(db, parked.item.itemId)).not.toMatchObject({ gateStatus: 'parked' });
  expect(await decisionRows(db, parked.item)).toBe(1);
}

async function takenOver(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const requestId = randomUUID();
  const body = { requestId, itemId: parked.item.itemId };
  const sent = await send(db, { email: kimEmail, item: parked.item }, 'take_over', body);
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect(await itemState(db, parked.item.itemId)).toMatchObject({ holder: parked.kim.identity });
  const after = await allEvents(db, parked.item.harnessId);
  expect(after.find((event) => event.name === 'gate_taken_over')).toMatchObject({
    requestId,
    evidence: { holder: parked.kim.identity },
  });
}

async function overridden(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const github = readyToShip(parked.item.itemId);
  const person = await gateDeps(github);
  const head = parked.item.expectedHead;
  const blank = { requestId: randomUUID(), itemId: parked.item.itemId, head, reason: '   ' };
  const refused = await send(db, { email: kimEmail, item: parked.item }, 'override', blank, person);
  expect(refused.body).toEqual({
    status: 'error',
    requestId: blank.requestId,
    reason: 'malformed_command',
  });
  expect(await decisionRows(db, parked.item)).toBe(0);
  const reason = 'The reviewer is away and the fix is urgent';
  const body = { ...blank, requestId: randomUUID(), reason };
  const sent = await send(db, { email: kimEmail, item: parked.item }, 'override', body, person);
  expect(sent.body).toEqual({ status: 'accepted', requestId: body.requestId });
  const after = await allEvents(db, parked.item.harnessId);
  expect(after.find((event) => event.name === 'gate_overridden')).toMatchObject({
    requestId: body.requestId,
    evidence: { reason },
  });
  const rows = await db.$client`
    SELECT reason FROM gate_decisions WHERE item_id = ${parked.item.itemId}`;
  expect(rows.map((row) => row.reason)).toEqual([reason]);
  expect(shipWrites(github)).toEqual([`PUT ${mergePath}`, `POST ${refs}`]);
}

describe.skipIf(!testServer)('WB-1 a person rejects, takes over and overrides', () => {
  it('WB-1 reject returns the item with its findings, take_over makes the person its holder, override needs a reason and records it', async () => {
    await withAppDatabase(rejected);
    await withAppDatabase(takenOver);
    await withAppDatabase(overridden);
  });
});

async function editorRefused(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const editor = { id: randomUUID(), email: 'editor10@unfoldingword.org' };
  await seedPerson(db, editor);
  await seedGrant(db, {
    id: randomUUID(),
    personId: editor.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const github = readyToShip(parked.item.itemId);
  const person = await gateDeps(github);
  const before = await eventCount(db, parked.item.harnessId);
  const head = parked.item.expectedHead;
  for (const [name, extra] of gateBodies(head)) {
    const requestId = randomUUID();
    const body = { requestId, itemId: parked.item.itemId, ...extra };
    const sent = await send(db, { email: editor.email, item: parked.item }, name, body, person);
    expect(sent.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  }
  expect(await eventCount(db, parked.item.harnessId)).toBe(before);
  expect(await decisionRows(db, parked.item)).toBe(0);
  expect(github.requests()).toEqual([]);
  const ledger = await db.$client`SELECT count(*)::int AS n FROM command_requests`;
  expect(Number(ledger[0]?.n)).toBe(0);
}

function gateBodies(
  head: string | null,
): ReadonlyArray<readonly [string, Record<string, unknown>]> {
  return [
    ['approve', { head }],
    ['reject', { findings: [] }],
    ['take_over', {}],
    ['override', { head, reason: 'urgent' }],
  ];
}

async function replayRechecks(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const person = await gateDeps(readyToShip(parked.item.itemId));
  const body = { requestId: randomUUID(), itemId: parked.item.itemId, findings: ['Slow'] };
  const first = await send(db, { email: kimEmail, item: parked.item }, 'reject', body, person);
  expect(first.body).toEqual({ status: 'accepted', requestId: body.requestId });
  await revokeSeededGrant(db, kimGrantId, new Date(Date.now() - 1000));
  const events = await eventCount(db, parked.item.harnessId);
  const replay = await send(db, { email: kimEmail, item: parked.item }, 'reject', body, person);
  expect(replay.body).toEqual({
    status: 'error',
    requestId: body.requestId,
    reason: 'harness_not_found',
  });
  expect(await eventCount(db, parked.item.harnessId)).toBe(events);
}

describe.skipIf(!testServer)('WB-1 only a person with admin decides a gate', () => {
  it("WB-1 an editor's approve is not_permitted before any state", () =>
    withAppDatabase(editorRefused));

  it('a replayed gate decision is checked again, and a revoked person gets the refusal', () =>
    withAppDatabase(replayRechecks));
});

async function recovered(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const lost = await kernelThatLosesTheExit(db, parked.item.itemId);
  const decision = { itemId: parked.item.itemId, decision: 'approve' as const, reason: null };
  await expect(
    lost.gates.decide(callerOf(parked.kim), {
      ...decision,
      findings: [],
      seenHead: parked.item.expectedHead,
    }),
  ).rejects.toThrow('the exit was lost');
  expect(namesOf(await allEvents(db, parked.item.harnessId))).not.toContain('connector_succeeded');
  const github = alreadyShipped(parked.item.itemId);
  const requestId = randomUUID();
  const sent = await send(
    db,
    { email: kimEmail, item: parked.item },
    'recover_connectors',
    { requestId },
    await gateDeps(github),
  );
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  const after = await allEvents(db, parked.item.harnessId);
  expect(after.find((event) => event.name === 'connector_succeeded')).toMatchObject({ requestId });
  expect(shipWrites(github)).toEqual([]);
}

describe.skipIf(!testServer)('WB-1 a person recovers a lost connector result', () => {
  it('WB-1 recover_connectors records a lost connector result', () => withAppDatabase(recovered));
});
