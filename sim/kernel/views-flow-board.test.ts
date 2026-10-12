import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { bml, type BoardView, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { value } from '../runs.ts';
import { enqueuedMany, flowWorld, itemNow, minute, type FlowWorld } from '../views.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const missingId = '00000000-0000-4000-8000-0000000000ff';

async function inFlow(work: (scene: FlowWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await flowWorld(world));
  } finally {
    await world.close();
  }
}

function flowIt(title: string, work: (scene: FlowWorld) => Promise<void>): void {
  it(title, () => inFlow(work));
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'accepted' ? 'accepted' : outcome.reason;
}

function adminCaller(scene: FlowWorld) {
  return simCaller(scene.world, scene.admin);
}

describe('the Flow view', () => {
  flowIt(
    'WB-4 the flow view lists every stage in position order with its bracket, feeds and pause',
    async (scene) => {
      const { stages } = scene.world.kernel;
      const input = { harnessId: scene.harnessId, stageKey: 'validate' };
      value(await stages.pause(adminCaller(scene), input));
      const read = await scene.world.kernel.reads.harness(adminCaller(scene), input);
      const flow = value(await scene.world.kernel.views.flow(adminCaller(scene), input));
      const ordered = [...value(read).stages].sort((a, b) => a.position - b.position);
      expect(flow.harness.id).toBe(scene.harnessId);
      expect(flow.stages.map((row) => row.stage)).toEqual(ordered);
      expect(flow.stages.map((row) => [row.stage.key, row.stage.paused])).toContainEqual([
        'validate',
        true,
      ]);
      expect(flow.stages.find((row) => row.stage.key === 'validate')?.stage.feeds).toEqual([
        'package',
      ]);
    },
  );

  flowIt(
    'WB-4 each stage counts open items, held items against its limit, the oldest entry and its runs cost',
    async (scene) => {
      const input = { harnessId: scene.harnessId };
      const flow = value(await scene.world.kernel.views.flow(adminCaller(scene), input));
      const row = (key: string) => flow.stages.find((entry) => entry.stage.key === key);
      const start = new Date('2026-10-01T09:00:00.000Z');
      expect(row('scope')).toMatchObject({
        count: 2,
        held: 2,
        oldestEnteredAt: start,
        cost: {
          meteredMinor: 3,
          computeMinor: 0,
          meteredTokens: 120,
          subscriptionTokens: 1200,
          currency: 'USD',
        },
      });
      expect(row('package')).toMatchObject({
        count: 2,
        held: 1,
        oldestEnteredAt: new Date(start.getTime() + 9 * minute),
        cost: { meteredMinor: 0, meteredTokens: 0, subscriptionTokens: 0 },
      });
      expect(row('ship')).toMatchObject({ count: 0, held: 0, oldestEnteredAt: null });
    },
  );
});

describe('the Flow view and the Board hide what the caller cannot read', () => {
  flowIt(
    'a harness the caller cannot read is harness_not_found on the flow and the board, byte for byte the same as a missing one',
    async (scene) => {
      const stranger = simCaller(scene.world, await simPerson(scene.world, 3, []));
      const elsewhere = simCaller(
        scene.world,
        await simPerson(scene.world, 5, [
          { role: 'viewer', scopeKind: 'jd_area', scopeArea: '20-29' },
        ]),
      );
      const { views } = scene.world.kernel;
      const hidden = { harnessId: scene.harnessId };
      const missing = { harnessId: missingId };
      const board = { stageKey: null, after: null };
      for (const caller of [stranger, elsewhere]) {
        const pairs = [
          [await views.flow(caller, hidden), await views.flow(caller, missing)],
          [
            await views.board(caller, { ...hidden, ...board }),
            await views.board(caller, { ...missing, ...board }),
          ],
        ];
        for (const [shown, absent] of pairs) {
          expect(reasonOf(shown as KernelOutcome<unknown>)).toBe('harness_not_found');
          expect(JSON.stringify(shown).replaceAll(scene.harnessId, missingId)).toBe(
            JSON.stringify(absent),
          );
        }
      }
    },
  );
});

function boardOf(scene: FlowWorld, stageKey: string | null = null, after: Cursor = null) {
  const input = { harnessId: scene.harnessId, stageKey, after };
  return scene.world.kernel.views.board(adminCaller(scene), input);
}

type Cursor = { readonly priority: number; readonly itemId: string } | null;
type Column = BoardView['columns'][number];

function columnAt(board: BoardView, key: string): Column {
  const found = board.columns.find((column) => column.stage.key === key);
  if (found === undefined) throw new Error(`no ${key} column`);
  return found;
}

function cursorOf(column: Column): { readonly priority: number; readonly itemId: string } {
  const last = column.cards.at(-1);
  if (last === undefined) throw new Error('the column is empty');
  return { priority: last.item.priority, itemId: last.item.itemId };
}

async function firstFifty(scene: FlowWorld): Promise<void> {
  const backlog = await enqueuedMany(scene, 50);
  const board = value(await boardOf(scene));
  const flow = value(
    await scene.world.kernel.views.flow(adminCaller(scene), { harnessId: scene.harnessId }),
  );
  expect(board.columns.map((column) => column.stage)).toEqual(flow.stages.map((row) => row.stage));
  const first = columnAt(board, 'package');
  const cursor = cursorOf(first);
  expect([first.held, first.cards.length, first.next]).toEqual([
    1,
    50,
    `${cursor.priority}.${cursor.itemId}`,
  ]);
  const rest = columnAt(value(await boardOf(scene, 'package', cursor)), 'package');
  expect([rest.cards.length, rest.next]).toEqual([2, null]);
  const listed = [...first.cards, ...rest.cards].map((card) => card.item.itemId);
  expect(listed.sort()).toEqual([...backlog, scene.personHeld, scene.unheld].sort());
}

async function leaseOf(scene: FlowWorld, itemId: string): Promise<Date | null> {
  const lease = (await itemNow(scene.world, itemId))?.leaseExpiresAt ?? null;
  return lease === null ? null : new Date(lease);
}

async function leases(scene: FlowWorld): Promise<void> {
  const cards = value(await boardOf(scene)).columns.flatMap((column) => column.cards);
  const card = (itemId: string) => cards.find((entry) => entry.item.itemId === itemId);
  expect(card(scene.metered)).toMatchObject({
    host: 'workflow-run',
    bases: ['metered'],
    leaseExpiresAt: await leaseOf(scene, scene.metered),
    liveRun: { outcome: 'running' },
  });
  expect(card(scene.metered)?.leaseExpiresAt).toBeInstanceOf(Date);
  expect(card(scene.subscribed)).toMatchObject({
    host: 'external-run',
    bases: ['subscription'],
    leaseExpiresAt: await leaseOf(scene, scene.subscribed),
    cost: { subscriptionTokens: 1200, meteredMinor: 0 },
  });
  expect(card(scene.personHeld)).toMatchObject({
    host: 'person',
    leaseExpiresAt: null,
    bases: [],
    liveRun: null,
  });
  expect(card(scene.unheld)).toMatchObject({ host: null, leaseExpiresAt: null, bases: [] });
}

async function oneStage(scene: FlowWorld): Promise<void> {
  const scope = value(await boardOf(scene, 'scope'));
  expect(scope.columns.map((column) => column.stage.key)).toEqual(['scope']);
  expect(
    columnAt(scope, 'scope')
      .cards.map((card) => card.item.itemId)
      .sort(),
  ).toEqual([scene.metered, scene.subscribed].sort());
  expect(reasonOf(await boardOf(scene, 'nowhere'))).toBe('stage_not_found');
  const unstaged = await boardOf(scene, null, { priority: 1, itemId: scene.unheld });
  expect(reasonOf(unstaged)).toBe('stage_not_found');
}

describe('the Board', () => {
  flowIt(
    'WB-5 the board gives one column per stage with its held count and its first 50 cards',
    firstFifty,
  );
  flowIt('WB-5 a card shows a lease expiry for an agent holder and none for a person', leases);
  flowIt(
    'WB-5 the board filtered to one stage answers that column only; an unknown stage is stage_not_found',
    oneStage,
  );
});

describe('the harness list', () => {
  flowIt('the harness list answers only harnesses the caller can read, by key', async (scene) => {
    const other = await createSimHarness(scene.world, bml, { key: 'a-bml', jdArea: '20-29' });
    const { views } = scene.world.kernel;
    const keys = async (caller: ReturnType<typeof adminCaller>) =>
      (await views.harnesses(caller)).map((harness) => harness.key);
    const viewer = simCaller(
      scene.world,
      await simPerson(scene.world, 7, [
        { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]),
    );
    const stranger = simCaller(scene.world, await simPerson(scene.world, 3, []));
    expect(await keys(adminCaller(scene))).toEqual([other.harness.key, 'software']);
    expect(await keys(viewer)).toEqual(['software']);
    expect(await keys(stranger)).toEqual([]);
  });
});
