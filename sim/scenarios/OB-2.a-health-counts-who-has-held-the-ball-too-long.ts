import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const hour = 3_600_000;

export const scenario = defineScenario({
  id: 'OB-2',
  title:
    'a person who has held an item for over 24 hours is counted on /health with the drill-through row, and the Board card says who and for how long',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const caller = simCaller(world, admin);
    const { itemId } = value(
      await world.kernel.items.enqueue(caller, {
        harnessId: harness.id,
        title: 'Hold the package',
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
    world.adapters.clock.advance(23 * hour);
    const early = (await world.kernel.views.holds()).person.length;
    world.adapters.clock.advance(2 * hour);
    const holds = await world.kernel.views.holds();
    const rows = await world.kernel.views.planeList(caller, 'held_by_person');
    const board = value(
      await world.kernel.views.board(caller, {
        harnessId: harness.id,
        stageKey: null,
        after: null,
      }),
    );
    const card = board.columns
      .flatMap((column) => column.cards)
      .find((entry) => entry.item.itemId === itemId);
    assert.equal(early, 0);
    assert.deepEqual(
      holds.person.map((row) => row.item.itemId),
      [itemId],
    );
    assert.deepEqual(
      rows.map((row) => [row.cells['item'], row.cells['held']]),
      [['Hold the package', '1 d 1 h']],
    );
    assert.equal(card?.holder?.identity, admin.identity);
    return { state: { held: holds.person.length, rows: rows.length } };
  },
});
