import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  accepted,
  callerOf,
  command,
  dispatchAs,
  dispatchScope,
  enqueued,
  eventsNamed,
  ian,
  softwareHarness,
} from '../testing/commands.ts';

async function itemAtClose(db: Database, harnessId: string): Promise<string> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const admin = callerOf(await ian(db));
  const change = { feeds: ['close'] };
  accepted(await kernel.stages.updateStage(admin, { harnessId, stageKey: 'package', change }));
  const itemId = await enqueued(db, harnessId, 'Tune the lantern guide');
  accepted(await kernel.items.claim(admin, { itemId, delegationId: null }));
  accepted(await kernel.items.submit(admin, { itemId, to: 'close', evidence: {}, change: null }));
  return itemId;
}

function reading(itemId: string) {
  return {
    requestId: randomUUID(),
    itemId,
    source: 'web_analytics',
    name: 'weekly readers',
    value: 42,
    asOf: '2026-01-01',
  };
}

async function personsWrite(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await itemAtClose(db, scene.harnessId);
  const send = (who: { readonly email: string }) =>
    command(db, who, scene.harnessId, 'record_measurement', reading(itemId));
  expect((await send(scene.viewer)).body).toMatchObject({ reason: 'not_permitted' });
  const agent = agentOf(await ian(db), 'laptop');
  const fromAgent = await dispatchAs(
    agent,
    scene.harnessId,
    'record_measurement',
    reading(itemId),
    dispatchScope(db),
  );
  expect(fromAgent).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await eventsNamed(db, scene.harnessId, 'measurement_recorded')).toHaveLength(0);
  const done = await send(scene.editor);
  expect([done.status, done.body['status']]).toEqual([200, 'accepted']);
  const recorded = await eventsNamed(db, scene.harnessId, 'measurement_recorded');
  expect(recorded.map((event) => [event.itemId, event.evidence['value']])).toEqual([[itemId, 42]]);
}

describe.skipIf(!testServer)('the record_measurement command', () => {
  it("record_measurement is a person's write and is refused to agents", () =>
    withAppDatabase(personsWrite));
});
