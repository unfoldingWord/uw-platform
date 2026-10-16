import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  secondChange,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'SR-3',
  title:
    'an approved neighbour merges, and an item whose own facts carry no approval is refused no_reviewer_approval with no connector call for it',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const caller = () => simCaller(world, admin);
    const parked = (title: string, change: typeof standardChange) =>
      simParkedAtShip(world, { harnessId: harness.id, editor: admin, title, change });
    const item = await parked('Show the board', standardChange);
    const other = await parked('Show the flow', secondChange);
    const neighbour = [approvedBy('uw-reviewer[bot]', 'deepinfra', secondChange.head, 9300000002)];
    world.adapters.githubFacts.given(
      greenFacts(world, {
        itemId: other.itemId,
        head: secondChange.head,
        ref: secondChange.pullRequest,
        reviews: neighbour,
      }),
    );
    world.adapters.githubFacts.given(
      greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews: [] }),
    );
    const decide = (itemId: string, seenHead: string) =>
      world.kernel.gates.decide(caller(), {
        itemId,
        decision: 'approve',
        reason: null,
        findings: [],
        seenHead,
      });
    const advanced = value(await decide(other.itemId, secondChange.head)).advanced;
    const refused = reasonOf(await decide(item.itemId, standardChange.head));
    const called = world.adapters.connectors.calls().map((call) => call.itemId);
    assert.equal(advanced, true);
    assert.equal(refused, 'no_reviewer_approval');
    assert.deepEqual(called, [other.itemId]);
    return { state: { called } };
  },
});
