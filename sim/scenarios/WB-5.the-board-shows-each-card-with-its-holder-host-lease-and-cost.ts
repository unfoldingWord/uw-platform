import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { flowWorld } from '../views.ts';

export const scenario = defineScenario({
  id: 'WB-5',
  title:
    'the Board shows each card with its holder, its host, a lease only for an agent holder and the cost bases its runs used',
  run: async (world) => {
    const scene = await flowWorld(world);
    const caller = simCaller(world, scene.admin);
    const input = { harnessId: scene.harnessId, stageKey: null, after: null };
    const board = value(await world.kernel.views.board(caller, input));
    const cards = board.columns
      .filter((column) => column.cards.length > 0)
      .flatMap((column) =>
        column.cards.map((card) => ({
          stage: column.stage.key,
          title: card.item.title,
          holder: card.item.holder?.split(':')[0] ?? null,
          host: card.host,
          lease: card.leaseExpiresAt !== null,
          bases: card.bases,
        })),
      );
    assert.equal(board.columns.length, 8);
    assert.equal(cards.filter((card) => card.lease).length, 2);
    return { state: { cards } };
  },
});
