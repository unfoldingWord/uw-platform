import assert from 'node:assert/strict';
import { software, type PullRequestFacts } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  secondChange,
  simParkedAtShip,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Planted = (facts: PullRequestFacts) => PullRequestFacts;

async function refusedWith(
  world: World,
  ids: { readonly harnessId: string; readonly admin: Parameters<typeof simCaller>[1] },
  change: ShipChange,
  plant: Planted,
): Promise<string | null> {
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
    head: change.head,
    ref: change.pullRequest,
    reviews,
  });
  world.adapters.githubFacts.given(plant(facts));
  const input = {
    itemId: item.itemId,
    decision: 'approve' as const,
    reason: null,
    findings: [],
    seenHead: change.head,
  };
  return reasonOf(await world.kernel.gates.decide(simCaller(world, admin), input));
}

export const scenario = defineScenario({
  id: 'SR-1',
  title:
    'a person approving at Ship is refused base_behind on a head two commits behind its base, and auto_close_keyword on a body closing another issue',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const ids = { harnessId: harness.id, admin };
    const behind = await refusedWith(world, ids, standardChange, (facts) => ({
      ...facts,
      comparison: comparedAt(facts.head, { behindBy: 2 }),
    }));
    const closing = await refusedWith(world, ids, secondChange, (facts) => ({
      ...facts,
      closes: [{ repo: 'unfoldingWord/uw-platform', number: 99 }],
    }));
    assert.equal(behind, 'base_behind');
    assert.equal(closing, 'auto_close_keyword');
    return { state: { reasons: [behind, closing] } };
  },
});
