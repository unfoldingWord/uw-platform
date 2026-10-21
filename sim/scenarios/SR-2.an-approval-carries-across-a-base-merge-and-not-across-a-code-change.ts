import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  secondChange,
  simParkedAtShip,
  simPatchId,
  simSha,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Pushed = { readonly sha: string; readonly merge: boolean; readonly patchId: string };

async function approvedAfterPush(
  world: World,
  ids: { readonly harnessId: string; readonly admin: Parameters<typeof simCaller>[1] },
  change: ShipChange,
  pushed: Pushed,
) {
  const { harnessId, admin } = ids;
  const item = await simParkedAtShip(world, {
    harnessId,
    editor: admin,
    title: 'Show the board',
    change,
  });
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', change.head, 9300000001)];
  const facts = greenFacts(world, {
    itemId: item.itemId,
    head: pushed.sha,
    ref: change.pullRequest,
    reviews,
  });
  const commits = [
    { sha: change.head, merge: false, skipCi: false, closes: [] },
    { sha: pushed.sha, merge: pushed.merge, skipCi: false, closes: [] },
  ];
  const patchIds = { [change.head]: simPatchId('9a7c'), [pushed.sha]: pushed.patchId };
  const comparison = comparedAt(pushed.sha, { commits, patchIds, patchId: pushed.patchId });
  world.adapters.githubFacts.given({ ...facts, comparison });
  const input = {
    itemId: item.itemId,
    decision: 'approve' as const,
    reason: null,
    findings: [],
    seenHead: change.head,
  };
  return world.kernel.gates.decide(simCaller(world, admin), input);
}

export const scenario = defineScenario({
  id: 'SR-2',
  title:
    'an approval carries across a merge from base and the merge runs at the new head; a code change pushed after the approval refuses head_mismatch',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const ids = { harnessId: harness.id, admin };
    const merged = { sha: simSha('b4e2'), merge: true, patchId: simPatchId('9a7c') };
    const advanced = value(await approvedAfterPush(world, ids, standardChange, merged)).advanced;
    const changed = { sha: simSha('c0de'), merge: false, patchId: simPatchId('c0de') };
    const refused = reasonOf(await approvedAfterPush(world, ids, secondChange, changed));
    assert.equal(advanced, true);
    assert.equal(refused, 'head_mismatch');
    assert.deepEqual(
      world.adapters.connectors.calls().map((call) => call.expectedHead),
      [merged.sha],
    );
    return { state: { advanced, refused } };
  },
});
