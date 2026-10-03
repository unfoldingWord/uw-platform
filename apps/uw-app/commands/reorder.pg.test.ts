import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { platformStore } from '../ports/store.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  accepted,
  callerOf,
  command,
  enqueued,
  eventsNamed,
  get,
  ian,
  type Person,
  type Scene,
  softwareHarness,
} from '../testing/commands.ts';

function itemsPath(harnessId: string, stage: string): string {
  return `/api/harness/${harnessId}/stages/${stage}/items`;
}

async function listed(db: Database, by: Person, harnessId: string, stage: string) {
  const read = await get(db, { email: by.email }, itemsPath(harnessId, stage));
  expect(read.status).toBe(200);
  const items = read.body['items'] as readonly { readonly itemId: string }[];
  return items.map((item) => item.itemId);
}

async function threeEnqueued(db: Database, scene: Scene) {
  const a = await enqueued(db, scene.harnessId, 'A');
  const b = await enqueued(db, scene.harnessId, 'B');
  const c = await enqueued(db, scene.harnessId, 'C');
  const order = await listed(db, scene.viewer, scene.harnessId, 'package');
  expect([...order].sort()).toEqual([a, b, c].sort());
  return order;
}

async function reorderBefore(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const [first, second, third] = await threeEnqueued(db, scene);
  const requestId = randomUUID();
  const sent = await command(db, scene.editor, scene.harnessId, 'reorder', {
    requestId,
    itemId: third,
    beforeItemId: first,
  });
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect(await listed(db, scene.viewer, scene.harnessId, 'package')).toEqual([
    third,
    first,
    second,
  ]);
  const reordered = await eventsNamed(db, scene.harnessId, 'item_reordered');
  expect(reordered.every((event) => event.requestId === requestId)).toBe(true);
}

async function staleBoard(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const order = await threeEnqueued(db, scene);
  const [first, , third] = order;
  if (first === undefined || third === undefined) throw new Error('three items expected');
  const kernel = kernelOn(db, { now: () => new Date() });
  const admin = callerOf(await ian(db));
  accepted(await kernel.items.claim(admin, { itemId: first, delegationId: null }));
  accepted(
    await kernel.items.submit(admin, { itemId: first, to: null, evidence: {}, change: null }),
  );
  const requestId = randomUUID();
  const sent = await command(db, scene.editor, scene.harnessId, 'reorder', {
    requestId,
    itemId: third,
    beforeItemId: first,
  });
  expect(sent.body).toEqual({ status: 'error', requestId, reason: 'malformed_command' });
  expect(await eventsNamed(db, scene.harnessId, 'item_reordered')).toEqual([]);
  expect(await listed(db, scene.viewer, scene.harnessId, 'package')).toEqual(
    order.filter((itemId) => itemId !== first),
  );
}

async function hiddenStageItems(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueued(db, scene.harnessId, 'Hidden');
  const hidden = await get(
    db,
    { email: scene.stranger.email },
    itemsPath(scene.harnessId, 'package'),
  );
  const missing = await get(
    db,
    { email: scene.stranger.email },
    itemsPath(randomUUID(), 'package'),
  );
  const malformed = await get(
    db,
    { email: scene.editor.email },
    itemsPath('not-a-uuid', 'package'),
  );
  const hiddenNoStage = await get(
    db,
    { email: scene.stranger.email },
    itemsPath(scene.harnessId, 'Not_A_Stage'),
  );
  expect(hidden.status).toBe(404);
  expect(hidden.body).toEqual({ status: 'error', reason: 'harness_not_found' });
  for (const other of [missing, malformed, hiddenNoStage]) {
    expect(other.status).toBe(hidden.status);
    expect(other.text).toBe(hidden.text);
  }
  const noStage = await get(db, { email: scene.editor.email }, itemsPath(scene.harnessId, 'nope'));
  expect(noStage.status).toBe(404);
  expect(noStage.body).toEqual({ status: 'error', reason: 'stage_not_found' });
}

async function markedDone(db: Database, itemId: string): Promise<void> {
  await platformStore(db).transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null) throw new Error('item vanished');
    await tx.harnessItems.write.project({ ...item, gateStatus: 'done' });
  });
}

async function pagedStageItems(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const ids: string[] = [];
  for (let n = 0; n < 52; n += 1) ids.push(await enqueued(db, scene.harnessId, `Item ${n}`));
  const done = ids[7] ?? '';
  await markedDone(db, done);
  const reader = { email: scene.viewer.email };
  const first = await get(db, reader, itemsPath(scene.harnessId, 'package'));
  const firstItems = first.body['items'] as readonly { readonly itemId: string }[];
  expect(firstItems).toHaveLength(50);
  const next = first.body['next'];
  expect(typeof next).toBe('string');
  const after = `${itemsPath(scene.harnessId, 'package')}?after=${String(next)}`;
  const second = await get(db, reader, after);
  const secondItems = second.body['items'] as readonly { readonly itemId: string }[];
  expect(second.body['next']).toBeNull();
  const read = [...firstItems, ...secondItems].map((item) => item.itemId);
  expect(read).toEqual(ids.filter((itemId) => itemId !== done).sort());
  const malformed = await get(db, reader, `${itemsPath(scene.harnessId, 'package')}?after=x`);
  expect(malformed.status).toBe(400);
  expect(malformed.body).toEqual({ status: 'error', reason: 'malformed_command' });
}

async function serviceTokenReadsNothing(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueued(db, scene.harnessId, 'Hidden');
  const read = await get(
    db,
    { common_name: 'runner.access' },
    itemsPath(scene.harnessId, 'package'),
  );
  expect(read.status).toBe(401);
  expect(read.body).toEqual({ status: 'error', reason: 'unauthenticated' });
}

describe.skipIf(!testServer)('WB-2 reorder through the command API', () => {
  it('WB-2 reorder through the command API places the item before the named one and the stage’s items read back in the server’s order', () =>
    withAppDatabase(reorderBefore));

  it('WB-2 a stale board’s reorder against an item now in another stage is refused and the order is unchanged', () =>
    withAppDatabase(staleBoard));
});

describe.skipIf(!testServer)('the stage’s items read', () => {
  it('a harness the caller may not read, a missing one and a malformed id answer harness_not_found byte-identically; a missing stage answers stage_not_found', () =>
    withAppDatabase(hiddenStageItems));

  it('WB-2 the stage’s items read pages fifty at a time with a cursor in the server’s order and leaves done items out', () =>
    withAppDatabase(pagedStageItems));

  it('an agent service token reads no stage through the person route', () =>
    withAppDatabase(serviceTokenReadsNothing));
});
