import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandName, Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { claimRequest } from './requests.ts';
import {
  accepted,
  dispatchAs,
  dispatchScope,
  eventsNamed,
  softwareHarness,
} from '../testing/commands.ts';

const SIX_MINUTES = 6 * 60 * 1000;

async function productPage(db: Database): Promise<string> {
  const id = randomUUID();
  await seedPage(db, {
    id,
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    bodyMd: 'The board.',
    slug: `board-${id.slice(0, 8)}`,
    title: 'The board',
  });
  return id;
}

type FirstRun = {
  readonly actor: Principal;
  readonly harnessId: string;
  readonly command: CommandName;
  readonly requestId: string;
  readonly pageId: string | null;
};

async function firstRunCommittedAndStalled(db: Database, run: FirstRun): Promise<void> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const caller = { actor: run.actor, traceId: randomUUID(), requestId: run.requestId };
  accepted(
    await kernel.items.enqueue(caller, {
      harnessId: run.harnessId,
      title: 'The board',
      pageId: run.pageId,
      priority: 0,
      due: null,
      delegationId: null,
    }),
  );
  const claimed = await claimRequest(
    db,
    { actor: run.actor.identity, requestId: run.requestId },
    {
      command: run.command,
      harnessId: run.harnessId,
      traceId: randomUUID(),
      at: new Date(Date.now() - SIX_MINUTES),
    },
  );
  expect(claimed).toBe(true);
}

async function oneItemPerRequest(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const actor = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  const pageId = await productPage(db);
  const runs: ReadonlyArray<readonly [CommandName, Record<string, unknown>]> = [
    ['enqueue', { title: 'The board', pageId: null, due: null }],
    ['kickstart', { pageId }],
  ];
  for (const [command, body] of runs) {
    const requestId = randomUUID();
    const first = { actor, harnessId: scene.harnessId, command, requestId };
    await firstRunCommittedAndStalled(db, {
      ...first,
      pageId: command === 'kickstart' ? pageId : null,
    });
    const send = () =>
      dispatchAs(actor, scene.harnessId, command, { requestId, ...body }, dispatchScope(db));
    expect(await send()).toEqual({ status: 'accepted', requestId });
    expect(await send()).toEqual({ status: 'accepted', requestId });
    const created = await eventsNamed(db, scene.harnessId, 'item_created');
    expect(created.filter((event) => event.requestId === requestId)).toHaveLength(1);
  }
}

async function otherRequestsStillCreate(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const actor = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  const scope = dispatchScope(db);
  const body = { title: 'The board', pageId: null, due: null };
  for (let n = 0; n < 2; n += 1) {
    const requestId = randomUUID();
    const sent = await dispatchAs(actor, scene.harnessId, 'enqueue', { requestId, ...body }, scope);
    expect(sent).toEqual({ status: 'accepted', requestId });
  }
  const kernel = kernelOn(db, { now: () => new Date() });
  const unnamed = { actor, traceId: randomUUID() };
  for (let n = 0; n < 2; n += 1) {
    accepted(
      await kernel.items.enqueue(unnamed, {
        harnessId: scene.harnessId,
        ...body,
        priority: 0,
        delegationId: null,
      }),
    );
  }
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toHaveLength(4);
}

describe.skipIf(!testServer)('a retaken request creates no second item', () => {
  it('a retaken enqueue or kickstart whose first run already created the item answers accepted, creates nothing, and replays accepted', () =>
    withAppDatabase(oneItemPerRequest));

  it('distinct requestIds, and calls that name no requestId, each still create their item', () =>
    withAppDatabase(otherRequestsStillCreate));
});
