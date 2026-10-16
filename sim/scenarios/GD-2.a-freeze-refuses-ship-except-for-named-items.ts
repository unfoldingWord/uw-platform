import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'GD-2',
  title:
    'an admin freezes a harness naming no item, and Ship refuses harness_frozen until the freeze is lifted',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const caller = () => simCaller(world, admin);
    const item = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change: standardChange,
    });
    const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
    world.adapters.githubFacts.given(
      greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
    );
    value(
      await world.kernel.stages.setFreeze(caller(), {
        harnessId: harness.id,
        frozen: true,
        allow: [],
      }),
    );
    const input = {
      itemId: item.itemId,
      decision: 'approve' as const,
      reason: null,
      findings: [],
      seenHead: standardChange.head,
    };
    const refused = reasonOf(await world.kernel.gates.decide(caller(), input));
    value(
      await world.kernel.stages.setFreeze(caller(), {
        harnessId: harness.id,
        frozen: false,
        allow: [],
      }),
    );
    const shipped = value(await world.kernel.gates.decide(caller(), input));
    assert.equal(refused, 'harness_frozen');
    assert.equal(shipped.advanced, true);
    return { state: { refused, advanced: shipped.advanced } };
  },
});
