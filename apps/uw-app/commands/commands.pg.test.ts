import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  callerOf,
  command,
  enqueued,
  eventCount,
  eventsNamed,
  ian,
  post,
  responseSchema,
  softwareHarness,
  type Sent,
} from '../testing/commands.ts';

const seen: Sent[] = [];

async function sent(response: Promise<Sent>): Promise<Sent> {
  const done = await response;
  seen.push(done);
  return done;
}

function enqueueBody(requestId: string) {
  return { requestId, title: 'Draw the board', pageId: null, due: null };
}

async function itemState(db: Database, itemId: string) {
  const scene = await kernelOn(db, { now: () => new Date() }).reads.item(callerOf(await ian(db)), {
    itemId,
  });
  if (scene.status !== 'accepted') throw new Error(scene.reason);
  return scene.value.item;
}

async function enqueueStampsTheEvent(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const response = await sent(
    command(db, scene.editor, scene.harnessId, 'enqueue', enqueueBody(requestId)),
  );
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'accepted', requestId });
  const [created] = await eventsNamed(db, scene.harnessId, 'item_created');
  expect(created).toMatchObject({
    actor: `human:${scene.editor.id}`,
    requestId,
    traceId: response.traceId,
  });
}

async function repeatReplays(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const body = enqueueBody(randomUUID());
  const first = await sent(command(db, scene.editor, scene.harnessId, 'enqueue', body));
  const events = await eventCount(db, scene.harnessId);
  const second = await sent(command(db, scene.editor, scene.harnessId, 'enqueue', body));
  expect(second.status).toBe(first.status);
  expect(second.text).toBe(first.text);
  expect(await eventCount(db, scene.harnessId)).toBe(events);
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toHaveLength(1);
}

async function reuseIsMalformed(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Hold the board');
  const requestId = randomUUID();
  await sent(command(db, scene.editor, scene.harnessId, 'enqueue', enqueueBody(requestId)));
  const events = await eventCount(db, scene.harnessId);
  const reused = await sent(
    command(db, scene.editor, scene.harnessId, 'claim', { requestId, itemId }),
  );
  expect(reused.status).toBe(400);
  expect(reused.body).toEqual({ status: 'error', requestId, reason: 'malformed_command' });
  expect(await eventCount(db, scene.harnessId)).toBe(events);
}

async function viewerRefused(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const events = await eventCount(db, scene.harnessId);
  const requestId = randomUUID();
  const refused = await sent(
    command(db, scene.viewer, scene.harnessId, 'enqueue', enqueueBody(requestId)),
  );
  expect(refused.status).toBe(403);
  expect(refused.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  expect(await eventCount(db, scene.harnessId)).toBe(events);
}

async function hiddenIsMissing(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const body = enqueueBody(randomUUID());
  const hidden = await sent(command(db, scene.stranger, scene.harnessId, 'enqueue', body));
  const missing = await sent(command(db, scene.stranger, randomUUID(), 'enqueue', body));
  expect(hidden.status).toBe(404);
  expect(hidden.body).toMatchObject({ reason: 'harness_not_found' });
  expect(hidden.status).toBe(missing.status);
  expect(hidden.text).toBe(missing.text);
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toEqual([]);
}

async function unknownIsNotWired(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const response = await sent(
    command(db, scene.editor, scene.harnessId, 'merge_now', { requestId: randomUUID() }),
  );
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ status: 'error', reason: 'not_wired' });
}

async function notWiredAfterCan(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Prompt the board');
  const requestId = randomUUID();
  const body = { requestId, itemId, message: 'Look again' };
  const unwired = await sent(command(db, scene.editor, scene.harnessId, 'prompt_run', body));
  const viewer = await sent(command(db, scene.viewer, scene.harnessId, 'prompt_run', body));
  expect(unwired.body).toEqual({ status: 'error', requestId, reason: 'not_wired' });
  expect(viewer.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
}

async function mismatchedCommand(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const response = await sent(
    post(db, scene.editor.email, `/api/harness/${scene.harnessId}/commands/enqueue`, {
      command: 'claim',
      ...enqueueBody(requestId),
    }),
  );
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ status: 'error', requestId, reason: 'malformed_command' });
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toEqual([]);
}

async function claimAndRelease(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Claim the board');
  const claimed = await sent(
    command(db, scene.editor, scene.harnessId, 'claim', { requestId: randomUUID(), itemId }),
  );
  expect(claimed.body).toMatchObject({ status: 'accepted' });
  expect(await itemState(db, itemId)).toMatchObject({
    holder: `human:${scene.editor.id}`,
    claimantKind: 'person',
    leaseExpiresAt: null,
  });
  const released = await sent(
    command(db, scene.editor, scene.harnessId, 'release', { requestId: randomUUID(), itemId }),
  );
  expect(released.body).toMatchObject({ status: 'accepted' });
  expect(await itemState(db, itemId)).toMatchObject({ holder: null, leaseExpiresAt: null });
}

async function closedResponses(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  await sent(command(db, scene.editor, scene.harnessId, 'enqueue', enqueueBody(requestId)));
  await sent(command(db, scene.viewer, scene.harnessId, 'enqueue', enqueueBody(randomUUID())));
  await sent(command(db, scene.editor, scene.harnessId, 'nothing', {}));
  await sent(command(db, scene.editor, scene.harnessId, 'enqueue', { requestId }));
  await sent(command(db, scene.editor, 'not-a-uuid', 'enqueue', enqueueBody(randomUUID())));
  expect(seen.length).toBeGreaterThanOrEqual(5);
  for (const response of seen) {
    expect(() => responseSchema.parse(response.body)).not.toThrow();
  }
}

describe.skipIf(!testServer)('WB-1 the command API', () => {
  it('WB-1 enqueue appends item_created with the actor, the requestId and the trace id', () =>
    withAppDatabase(enqueueStampsTheEvent));

  it('WB-1 a repeated requestId replays the first outcome and appends nothing', () =>
    withAppDatabase(repeatReplays));

  it('WB-1 a requestId reused for another command is malformed_command', () =>
    withAppDatabase(reuseIsMalformed));

  it('WB-1 a viewer is refused not_permitted and nothing is appended', () =>
    withAppDatabase(viewerRefused));

  it('WB-1 a harness the caller may not read answers harness_not_found, byte-identical to a missing one', () =>
    withAppDatabase(hiddenIsMissing));

  it('WB-1 an unknown command answers not_wired', () => withAppDatabase(unknownIsNotWired));

  it('WB-1 a command that is not wired yet answers not_wired after can()', () =>
    withAppDatabase(notWiredAfterCan));

  it('WB-1 a body whose command names another command is malformed_command', () =>
    withAppDatabase(mismatchedCommand));

  it('WB-1 claim and release through the command API hold and free the item for the person, with no lease', () =>
    withAppDatabase(claimAndRelease));

  it('WB-1 every response is accepted or error with a closed reason and nothing else', () =>
    withAppDatabase(closedResponses));
});
