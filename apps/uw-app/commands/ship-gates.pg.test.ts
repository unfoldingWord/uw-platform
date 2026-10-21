import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { decisionRows } from '../github/testing/ship-rig.ts';
import {
  gateDeps,
  kimEmail,
  mergePath,
  parkedAtShip,
  readyToShip,
  refs,
  shipWrites,
} from '../github/testing/gate-rig.ts';
import {
  command,
  dispatchAs,
  dispatchScope,
  eventCount,
  ian,
  post,
  softwareHarness,
} from '../testing/commands.ts';
import { agentOf } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const head = 'a'.repeat(40);

async function belowTheirAction(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const batch = await command(db, scene.editor, scene.harnessId, 'decide_gates', {
    requestId: randomUUID(),
    entries: [{ itemId: randomUUID(), head, decision: 'approve' }],
  });
  const freeze = await command(db, scene.editor, scene.harnessId, 'set_freeze', {
    requestId: randomUUID(),
    frozen: true,
    allow: [],
  });
  const refute = await command(db, scene.viewer, scene.harnessId, 'refute_finding', {
    requestId: randomUUID(),
    itemId: randomUUID(),
    runId: randomUUID(),
    finding: 0,
  });
  for (const sent of [batch, freeze, refute]) {
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  }
  const wired = await command(db, scene.editor, scene.harnessId, 'refute_finding', {
    requestId: randomUUID(),
    itemId: randomUUID(),
    runId: randomUUID(),
    finding: 0,
  });
  expect(wired.body).toMatchObject({ status: 'error', reason: 'item_not_found' });
}

async function batchMerges(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const github = readyToShip(parked.item.itemId);
  const requestId = randomUUID();
  const entries = [
    { itemId: parked.item.itemId, head: parked.item.expectedHead, decision: 'approve' },
  ];
  const path = `/api/harness/${parked.item.harnessId}/commands/decide_gates`;
  const body = { command: 'decide_gates', requestId, entries };
  const sent = await post(db, kimEmail, path, body, await gateDeps(github));
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect(await decisionRows(db, parked.item)).toBe(1);
  expect(shipWrites(github)).toEqual([`PUT ${mergePath}`, `POST ${refs}`]);
}

async function agentBatchRefused(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const { harnessId } = parked.item;
  const agent = agentOf(await ian(db), 'builder');
  const before = await eventCount(db, harnessId);
  const requestId = randomUUID();
  const entries = [
    { itemId: parked.item.itemId, head: parked.item.expectedHead, decision: 'approve' },
  ];
  const body = { requestId, entries };
  const outcome = await dispatchAs(agent, harnessId, 'decide_gates', body, dispatchScope(db));
  expect(outcome).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  expect(await decisionRows(db, parked.item)).toBe(0);
  expect(await eventCount(db, harnessId)).toBe(before);
}

describe.skipIf(!testServer)('the ship and gate commands on the command API', () => {
  it('GD-1 decide_gates refuses an agent principal at the command API and records nothing', () =>
    withAppDatabase(agentBatchRefused));

  it('GD-1 GD-2 RV-2 decide_gates and set_freeze need admin and refute_finding needs write on the area, past which its wired handler answers', () =>
    withAppDatabase(belowTheirAction));

  it('GD-1 decide_gates approves a gate at Ship on the command API and merges it', () =>
    withAppDatabase(batchMerges));
});
