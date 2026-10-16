import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simAtShip,
  simLendMerge,
  standardChange,
} from '../ship-fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'MD-4',
  title:
    'a merge delegation never covers a protected path: the submit records ship_refused, writes no decision and leaves the item parked for a person',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software, {
      protectedPaths: ['apps/uw-app/'],
    });
    const input = { harnessId: harness.id, editor: admin, title: 'Show the board' };
    const item = await simAtShip(world, { ...input, change: standardChange });
    const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
    world.adapters.githubFacts.given(
      greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
    );
    const loan = await simLendMerge(world, admin, { harnessId: harness.id, maxTier: 'standard' });
    const agent = simCaller(world, loan.agent);
    const claimed = await world.kernel.items.claim(agent, {
      itemId: item.itemId,
      delegationId: loan.delegationId,
    });
    assert.equal(claimed.status, 'accepted');
    const submitted = await world.kernel.items.submit(agent, {
      itemId: item.itemId,
      to: null,
      evidence: {},
      change: null,
    });
    assert.equal(submitted.status, 'accepted');
    const failures = submitted.status === 'accepted' ? submitted.value.failures : [];
    assert.deepEqual(failures, ['protected_path_needs_person']);
    const log = await itemLog(world, harness.id, item.itemId);
    const last = log.events.at(-1);
    assert.equal(last?.name, 'ship_refused');
    assert.deepEqual(last?.evidence['reasons'], ['protected_path_needs_person']);
    assert.deepEqual(log.decisions, []);
    const parked = submitted.status === 'accepted' ? submitted.value.item.gateStatus : null;
    assert.equal(parked, 'parked');
    return { state: { failures: [...failures], decisions: log.decisions.length } };
  },
});
