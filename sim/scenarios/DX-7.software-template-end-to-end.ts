import assert from 'node:assert/strict';
import { travelThroughShip } from '../e2e/at-ship.ts';
import { everyGateCrossed } from '../e2e/coverage.ts';
import { travelToClose } from '../e2e/to-close.ts';
import { travelToShip } from '../e2e/to-ship.ts';
import { itemOf } from '../runs.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import { itemLog } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'DX-7',
  title:
    'one kickstarted item travels the software template from Package to Close with a hosted run and an external runner: a claim, a held premise, the lease warning and expiry, the PR declaration, a gate wake reaching only the people who can decide and a Zulip reply that decides nothing, the ship rule refusing, agents refused at the gate, a person approving, the merge connector, a measurement at Validate, a refused Close, a Close with a learning, and an Iterate beat under a delegation that lapses',
  run: async (world) => {
    const journey = await travelToShip(world);
    await travelThroughShip(journey);
    const { lapses } = await travelToClose(journey);
    const gates = await everyGateCrossed(journey);
    assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
    const item = await itemOf(world, journey.itemId);
    assert.ok(item);
    const { decisions } = await itemLog(world, journey.cast.harnessId, journey.itemId);
    return {
      state: {
        item: {
          stage: item.stageKey,
          gateStatus: item.gateStatus,
          head: item.expectedHead,
          tier: item.riskTier,
        },
        heldPremise: (await itemOf(world, journey.wrongItemId))?.stageKey ?? null,
        decisions,
        merges: world.adapters.connectors.calls().length,
        lapses,
        gates,
      },
    };
  },
});
