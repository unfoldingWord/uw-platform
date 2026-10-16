import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson, simSystem } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  simAtShip,
  simLendMerge,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];

type Merged = { readonly admin: Principal; readonly agent: Principal; readonly itemId: string };

async function mergeUnderDelegation(world: World): Promise<Merged> {
  const { harness, admin } = await createSimHarness(world, software);
  const input = { harnessId: harness.id, editor: admin, title: 'Show the board' };
  const item = await simAtShip(world, { ...input, change: standardChange });
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
  );
  const loan = await simLendMerge(world, admin, { harnessId: harness.id, maxTier: 'standard' });
  const agent = simCaller(world, loan.agent);
  await world.kernel.items.claim(agent, { itemId: item.itemId, delegationId: loan.delegationId });
  await world.kernel.items.submit(agent, {
    itemId: item.itemId,
    to: null,
    evidence: {},
    change: null,
  });
  await world.kernel.gates.exitDelegated(simCaller(world, simSystem()), { limit: 20 });
  return { admin, agent: loan.agent, itemId: item.itemId };
}

async function showsTheMerge(world: World): Promise<void> {
  const { admin, agent, itemId } = await mergeUnderDelegation(world);
  const merged = await world.kernel.views.delegatedMerges(simCaller(world, admin));
  expect(merged).toMatchObject({
    rows: [{ itemId, title: 'Show the board', email: admin.email }],
    capped: false,
  });
  const viewer = await simPerson(world, 9, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const none = { rows: [], capped: false };
  expect(await world.kernel.views.delegatedMerges(simCaller(world, viewer))).toEqual(none);
  expect(await world.kernel.views.delegatedMerges(simCaller(world, agent))).toEqual(none);
  const totals = await world.kernel.views.planeTotals({ at: world.adapters.clock.now() });
  expect(totals.liveDelegations).toMatchObject({ count: 1, merge: 1 });
  const listed = await world.kernel.views.planeList(simCaller(world, admin), 'live_delegations');
  expect(listed).toMatchObject([{ cells: { capability: 'merge', 'max tier': 'standard' } }]);
}

describe('MD-6 the Gates view and /health show delegated merges', () => {
  it('MD-6 lists a merge under a delegation for an admin, with the grantor and the expiry, and counts live merge delegations', async () => {
    const world = await createWorld();
    try {
      await showsTheMerge(world);
    } finally {
      await world.close();
    }
  });
});
