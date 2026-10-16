import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'EI-5',
  title:
    'the Board shows the items of one epic grouped under its title in sub-issue order, with an edge from the third to the fourth and the fourth waiting',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items } = value(await enqueueEpicAs(world, admin, harness.id));
    const board = value(
      await world.kernel.views.board(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: null,
        after: null,
      }),
    );
    const [group] = board.epics;
    assert.equal(board.epics.length, 1);
    assert.equal(group?.title, 'Epic intake');
    assert.deepEqual(
      group?.nodes.map((node) => node.itemId),
      items.map((item) => item.itemId),
    );
    const edges =
      group?.nodes.flatMap((node) => node.blockedBy.map((from) => [from, node.itemId])) ?? [];
    assert.deepEqual(edges, [[items[2]?.itemId, items[3]?.itemId]]);
    assert.deepEqual(
      group?.nodes.map((node) => node.waiting),
      [false, false, false, true],
    );
    return { state: { groups: board.epics.length, edges: edges.length } };
  },
});
