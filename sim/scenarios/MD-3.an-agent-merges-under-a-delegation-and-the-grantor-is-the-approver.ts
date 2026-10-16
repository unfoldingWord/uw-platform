import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller, simSystem } from '../fixtures.ts';
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
  id: 'MD-3',
  title:
    'an agent holding a merge delegation submits at Ship, the decision names the grantor as approver and the agent as actor, and the minute job merges it as the system',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
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
    assert.deepEqual(submitted.status === 'accepted' ? submitted.value.failures : null, []);
    const rows = await world.adapters.store.transaction((tx) =>
      tx.gateDecisions.read.forItem(item.itemId),
    );
    assert.equal(rows.length, 1);
    const [decision] = rows;
    const approver = decision?.actor ?? null;
    const actor = decision?.agentActor ?? null;
    assert.deepEqual(
      { approver, actor, delegationId: decision?.delegationId ?? null },
      { approver: admin.identity, actor: loan.agent.identity, delegationId: loan.delegationId },
    );
    assert.deepEqual(world.adapters.connectors.calls(), []);
    const exits = await world.kernel.gates.exitDelegated(simCaller(world, simSystem()), {
      limit: 20,
    });
    assert.deepEqual(exits, {
      status: 'accepted',
      value: { exited: [{ itemId: item.itemId, advanced: true }] },
    });
    assert.equal(world.adapters.connectors.calls().length, 1);
    const merged = (await itemLog(world, harness.id, item.itemId)).events.some(
      (event) => event.name === 'delegated_merge',
    );
    assert.equal(merged, true);
    return { state: { approver, actor, merged } };
  },
});
