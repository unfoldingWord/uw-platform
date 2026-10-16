import assert from 'node:assert/strict';
import { software, type BatchEntry } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { detailOf, reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  secondChange,
  simParkedAtShip,
  simSha,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';

const thirdChange: ShipChange = {
  ...standardChange,
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 44 },
  head: simSha('f00d'),
};

export const scenario = defineScenario({
  id: 'GD-1',
  title:
    'a person approves two gates in one decide_gates and both merge; a batch with one unapproved item records nothing',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = async (title: string, change: ShipChange, approved: boolean) => {
      const item = await simParkedAtShip(world, {
        harnessId: harness.id,
        editor: admin,
        title,
        change,
      });
      const reviews = approved
        ? [approvedBy('uw-reviewer[bot]', 'deepinfra', change.head, 9300000001)]
        : [];
      world.adapters.githubFacts.given(
        greenFacts(world, {
          itemId: item.itemId,
          head: change.head,
          ref: change.pullRequest,
          reviews,
        }),
      );
      return { itemId: item.itemId, head: change.head, decision: 'approve' } satisfies BatchEntry;
    };
    const batch = (entries: readonly BatchEntry[]) =>
      world.kernel.gates.decideGates(simCaller(world, admin), { harnessId: harness.id, entries });
    const first = await parked('Show the board', standardChange, true);
    const second = await parked('Show the flow', secondChange, true);
    const advanced = value(await batch([first, second])).decided.map((one) => one.advanced);
    const third = await parked('Show the queue', thirdChange, false);
    const refusal = await batch([third]);
    const refused = reasonOf(refusal);
    assert.deepEqual(advanced, [true, true]);
    assert.equal(refused, 'no_reviewer_approval');
    assert.deepEqual(detailOf(refusal), {
      stage: 'ship',
      reasons: ['no_reviewer_approval'],
      itemId: third.itemId,
    });
    return { state: { advanced, refused } };
  },
});
