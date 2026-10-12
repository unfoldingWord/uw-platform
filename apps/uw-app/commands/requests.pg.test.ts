import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandName, Outcome } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { commandHandler, fromKernel, type CommandHandler } from './handler.ts';
import { commandRegistryOf } from './registry.ts';
import { claimRequest, priorRequest, settleRequest } from './requests.ts';
import {
  dispatchAs,
  dispatchScope,
  eventsNamed,
  ian,
  softwareHarness,
  type Scene,
} from '../testing/commands.ts';

const FIVE_MINUTES = 5 * 60 * 1000;

function enqueueBody(requestId: string) {
  return { requestId, title: 'Draw the board', pageId: null, due: null };
}

async function onTwoConnections(
  work: (first: Database, second: Database, scene: Scene) => Promise<void>,
): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const first = createClient(database.connectionString);
  const second = createClient(database.connectionString);
  try {
    await work(first, second, await softwareHarness(first));
  } finally {
    await Promise.all([first.$client.end(), second.$client.end()]);
    await database.drop();
  }
}

function enqueueWith(run: CommandHandler['run']): ReadonlyMap<CommandName, CommandHandler> {
  const handler = commandHandler({ name: 'enqueue', action: 'write', run });
  return commandRegistryOf([handler]);
}

async function simultaneousClaims(first: Database, second: Database, scene: Scene): Promise<void> {
  const editor = await personOn(first, scene.editor.id, scene.editor.email, new Date());
  const body = enqueueBody(randomUUID());
  const outcomes = await Promise.all([
    dispatchAs(editor, scene.harnessId, 'enqueue', body, dispatchScope(first)),
    dispatchAs(editor, scene.harnessId, 'enqueue', body, dispatchScope(second)),
  ]);
  expect(await eventsNamed(first, scene.harnessId, 'item_created')).toHaveLength(1);
  const accepted = { status: 'accepted', requestId: body.requestId };
  const inFlight = { status: 'error', requestId: body.requestId, reason: 'request_in_flight' };
  expect(outcomes).toContainEqual(accepted);
  for (const outcome of outcomes) expect([accepted, inFlight]).toContainEqual(outcome);
}

async function runningDuplicate(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const editor = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  let finish = (): void => undefined;
  const held = new Promise<void>((resolve) => void (finish = resolve));
  let runs = 0;
  const registry = enqueueWith(async () => {
    runs += 1;
    await held;
    return { ok: true };
  });
  const body = enqueueBody(randomUUID());
  const scope = dispatchScope(db, { registry });
  const running = dispatchAs(editor, scene.harnessId, 'enqueue', body, scope);
  await expect.poll(() => runs).toBe(1);
  const duplicate = await dispatchAs(editor, scene.harnessId, 'enqueue', body, scope);
  expect(duplicate).toEqual({
    status: 'error',
    requestId: body.requestId,
    reason: 'request_in_flight',
  });
  finish();
  expect(await running).toEqual({ status: 'accepted', requestId: body.requestId });
  expect(runs).toBe(1);
}

async function staleClaimRetaken(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const key = { actor: `human:${scene.editor.id}`, requestId: randomUUID() };
  const at = new Date('2026-10-03T12:00:00.000Z');
  const claim = (when: number, command: 'enqueue' | 'claim' = 'enqueue') =>
    claimRequest(db, key, {
      command,
      harnessId: scene.harnessId,
      traceId: randomUUID(),
      at: new Date(at.getTime() + when),
    });
  expect(await claim(0)).toBe(true);
  expect(await claim(FIVE_MINUTES - 1)).toBe(false);
  expect(await claim(FIVE_MINUTES + 1, 'claim')).toBe(false);
  expect(await claim(FIVE_MINUTES + 1)).toBe(true);
  expect(await priorRequest(db, key)).toMatchObject({ kind: 'pending', command: 'enqueue' });
}

async function thrownReleases(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const editor = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  let runs = 0;
  const registry = enqueueWith(async (context, raw) => {
    runs += 1;
    if (runs === 1) throw new Error('the engine fell over');
    const body = raw as { readonly title: string };
    return fromKernel(
      await context.kernel.items.enqueue(context.caller, {
        harnessId: context.harnessId,
        title: body.title,
        pageId: null,
        priority: 0,
        due: null,
        delegationId: null,
      }),
    );
  });
  const body = enqueueBody(randomUUID());
  const scope = dispatchScope(db, { registry });
  await expect(dispatchAs(editor, scene.harnessId, 'enqueue', body, scope)).rejects.toThrow(
    'the engine fell over',
  );
  expect(await priorRequest(db, { actor: editor.identity, requestId: body.requestId })).toEqual({
    kind: 'none',
  });
  const retried = await dispatchAs(editor, scene.harnessId, 'enqueue', body, scope);
  expect(retried).toEqual({ status: 'accepted', requestId: body.requestId });
  expect(runs).toBe(2);
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toHaveLength(1);
}

async function keyedByActor(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const editor = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  const admin = await ian(db);
  const body = enqueueBody(randomUUID());
  const scope = dispatchScope(db);
  await dispatchAs(editor, scene.harnessId, 'enqueue', body, scope);
  const theirs = await dispatchAs(admin, scene.harnessId, 'enqueue', body, scope);
  expect(theirs).toEqual({ status: 'accepted', requestId: body.requestId });
  const actors = (await eventsNamed(db, scene.harnessId, 'item_created')).map((e) => e.actor);
  expect(actors).toEqual([editor.identity, admin.identity]);
}

async function settlesParsed(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const key = { actor: `human:${scene.editor.id}`, requestId: randomUUID() };
  const at = new Date();
  const claim = {
    command: 'enqueue' as const,
    harnessId: scene.harnessId,
    traceId: randomUUID(),
    at,
  };
  expect(await claimRequest(db, key, claim)).toBe(true);
  const junk = { status: 'accepted', requestId: key.requestId, extra: 'x' } as Outcome;
  await expect(
    settleRequest(db, key, { outcome: junk, traceId: claim.traceId, at }),
  ).rejects.toThrow();
  const outcome: Outcome = { status: 'error', requestId: key.requestId, reason: 'not_holder' };
  await settleRequest(db, key, { outcome, traceId: randomUUID(), at });
  expect(await priorRequest(db, key)).toMatchObject({ kind: 'pending' });
  await settleRequest(db, key, { outcome, traceId: claim.traceId, at });
  expect(await priorRequest(db, key)).toEqual({
    kind: 'settled',
    command: 'enqueue',
    harnessId: scene.harnessId,
    outcome,
  });
}

describe.skipIf(!testServer)('WB-1 the request ledger', () => {
  it('WB-1 two claims of one requestId at the same moment: one runs, the other is request_in_flight or replays', () =>
    onTwoConnections(simultaneousClaims));

  it('WB-1 a request still running answers request_in_flight to its duplicate, and the duplicate runs nothing', () =>
    withAppDatabase(runningDuplicate));

  it('WB-1 a pending claim older than five minutes is retaken', () =>
    withAppDatabase(staleClaimRetaken));

  it('WB-1 a thrown command releases its claim so a retry runs', () =>
    withAppDatabase(thrownReleases));

  it("the ledger keys requests by actor, so another person's requestId is not replayed to you", () =>
    withAppDatabase(keyedByActor));

  it('settles only an outcome the contract accepts, only for the claim that holds it, and reads it back parsed', () =>
    withAppDatabase(settlesParsed));
});
