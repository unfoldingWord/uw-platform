import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { readAllEvents, software, type Delegation, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simDelegate, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const ninetyDays = 90 * 24 * 60 * 60 * 1000;

async function grantIterate(world: World, harnessId: string, kim: Principal): Promise<Delegation> {
  const granted = await simDelegate(world, kim, {
    harnessId,
    persona: 'agent:iterate',
    capability: 'iterate',
    expiresAt: null,
    supersedes: null,
  });
  assert.equal(granted.status, 'accepted');
  if (granted.status !== 'accepted') throw new Error('the grant was refused');
  return granted.value;
}

function assertEditorOnly(principal: Principal): void {
  assert.equal(principal.identity, 'agent:iterate');
  assert.deepEqual(
    principal.grants.map((grant) => [grant.role, grant.scopeKind, grant.scopeArea]),
    [['editor', 'jd_area', '80-89']],
  );
}

function assertLapsed(outcome: KernelOutcome<unknown>): void {
  assert.equal(outcome.status, 'error');
  if (outcome.status !== 'error') return;
  assert.equal(outcome.reason, 'delegation_lapsed');
  assert.equal(outcome.detail['why'], 'grant_lost');
}

export const scenario = defineScenario({
  id: 'KN-16',
  title:
    'a delegation lapses when the person loses admin on the area: the beat is refused delegation_lapsed with grant_lost, and the log holds one delegation_lapsed',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
    const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
    const started = world.adapters.clock.now();
    const delegation = await grantIterate(world, harness.id, kim);
    assert.equal(delegation.expiresAt.getTime(), started.getTime() + ninetyDays);
    const agent = simCaller(world, simAgent(kim, 'iterate', { interactive: false }));
    const beat = () => world.kernel.delegations.beat(agent, { delegationId: delegation.id });
    const first = await beat();
    assert.equal(first.status, 'accepted');
    if (first.status === 'accepted') assertEditorOnly(first.value.principal);
    const adminGrant = kim.grants[0];
    assert.ok(adminGrant);
    await revokeSeededGrant(world.database.db, adminGrant.grantId, world.adapters.clock.now());
    assertLapsed(await beat());
    assertLapsed(await beat());
    const log = await world.adapters.store.transaction((tx) => readAllEvents(tx, harness.id, null));
    const lapses = log.filter((event) => event.name === 'delegation_lapsed');
    assert.equal(lapses.length, 1);
    return { state: { delegation: delegation.id, lapses: lapses.length, why: 'grant_lost' } };
  },
});
