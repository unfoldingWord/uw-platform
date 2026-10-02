import assert from 'node:assert/strict';
import { LEASE_MS, software, type Claimed, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

function agentClaim(outcome: KernelOutcome<Claimed>, expected: string): string | null {
  assert.equal(outcome.status, 'accepted');
  if (outcome.status !== 'accepted') throw new Error('unreachable');
  assert.equal(outcome.value.leaseExpiresAt, expected);
  assert.equal(outcome.value.item.holder, 'agent:builder');
  assert.equal(outcome.value.item.claimantKind, 'agent');
  assert.equal(outcome.value.item.delegationId, null);
  return outcome.value.leaseExpiresAt;
}

function personClaim(outcome: KernelOutcome<Claimed>, identity: string): string | null {
  assert.equal(outcome.status, 'accepted');
  if (outcome.status !== 'accepted') throw new Error('unreachable');
  assert.equal(outcome.value.item.holder, identity);
  assert.equal(outcome.value.item.claimantKind, 'person');
  assert.equal(outcome.value.item.leaseExpiresAt, null);
  return outcome.value.leaseExpiresAt;
}

export const scenario = defineScenario({
  id: 'KN-5',
  title:
    'an agent claim takes a 15-minute lease, a person claim takes none, and a held item refuses a second claimant',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    const admin = simCaller(world, await simIan(world));
    await world.kernel.stages.updateStage(admin, {
      harnessId: harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed' },
    });
    const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
    const owner = await simPerson(world, 2, [{ role: 'editor', ...area }]);
    const other = await simPerson(world, 3, [{ role: 'editor', ...area }]);
    const editor = simCaller(world, owner);
    const builder = simCaller(world, simAgent(owner, 'builder', { interactive: true }));
    const reviewer = simCaller(world, simAgent(other, 'reviewer', { interactive: true }));
    const enqueued = await world.kernel.items.enqueue(editor, {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    });
    assert.equal(enqueued.status, 'accepted');
    if (enqueued.status !== 'accepted') throw new Error('unreachable');
    const itemId = enqueued.value.itemId;
    const expected = new Date(world.adapters.clock.now().getTime() + LEASE_MS).toISOString();
    const claimed = await world.kernel.items.claim(builder, { itemId, delegationId: null });
    const lease = agentClaim(claimed, expected);
    const refusals = await Promise.all([
      world.kernel.items.claim(reviewer, { itemId, delegationId: null }),
      world.kernel.items.claim(editor, { itemId, delegationId: null }),
    ]);
    assert.deepEqual(
      refusals.map((outcome) => outcome.status === 'error' && outcome.reason),
      ['lease_held', 'lease_held'],
    );
    const released = await world.kernel.items.release(builder, { itemId, delegationId: null });
    assert.equal(released.status, 'accepted');
    const taken = await world.kernel.items.claim(editor, { itemId, delegationId: null });
    const personLease = personClaim(taken, owner.identity);
    return { state: { agentLease: lease, personLease } };
  },
});
