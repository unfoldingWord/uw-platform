import assert from 'node:assert/strict';
import {
  assistantLog,
  beginTurn,
  grantedScene,
  refusedWhy,
  requestId,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import {
  defaultMinor,
  secondAssistant,
  setBudget,
  spendMinor,
} from '../assistant-pool-fixtures.ts';
import { readSpend } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

async function admission(scene: AssistantScene, externalId: string): Promise<unknown> {
  const id = await requestId(scene, { externalId, note: 'Summarise my week.' });
  const outcome = await beginTurn(scene, id);
  if (outcome.status === 'accepted') return 'accepted';
  return refusedWhy(outcome, await assistantLog(scene));
}

async function adminRaisesMyBudget(scene: AssistantScene): Promise<readonly unknown[]> {
  await spendMinor(scene, defaultMinor + 100);
  const spent = await admission(scene, '1601');
  const mine = await setBudget(scene, scene.person, 9000);
  assert.equal(mine.status === 'error' && mine.reason, 'not_permitted');
  assert.equal((await setBudget(scene, scene.rowan, 5000)).status, 'accepted');
  return [spent, await admission(scene, '1602')];
}

async function poolBinds(scene: AssistantScene): Promise<readonly unknown[]> {
  const second = await secondAssistant(scene);
  await spendMinor(scene, 2800);
  const roomy = await admission(second, '1603');
  assert.equal((await setBudget(scene, scene.rowan, 1000)).status, 'accepted');
  const capped = await admission(second, '1604');
  assert.equal((await setBudget(scene, scene.rowan, 5000)).status, 'accepted');
  return [roomy, capped, await admission(second, '1605')];
}

async function breakerLeavesAssistantsOut(scene: AssistantScene): Promise<number | undefined> {
  const { world } = scene;
  world.adapters.modelEngine.setSpend({ spentMinor: 113_000, currency: 'USD' });
  await readSpend(world);
  const state = await world.kernel.breaker.state(world.adapters.clock.now());
  return state.reading?.spentMinor;
}

export const scenario = defineScenario({
  id: 'PA-16',
  title:
    'an admin raises my assistant budget and the turn the default refused is admitted; every enabled assistant shares one pool, the sum of their budgets, and a turn is refused assistants_capped once it is spent; assistant spend stays out of the platform spend reading',
  run: async (world) => {
    const scene = await grantedScene(world);
    const raised = await adminRaisesMyBudget(scene);
    assert.deepEqual(raised, ['assistant_budget_spent', 'accepted']);
    const pooled = await poolBinds(scene);
    assert.deepEqual(pooled, ['accepted', 'assistants_capped', 'accepted']);
    const platformMinor = await breakerLeavesAssistantsOut(scene);
    assert.ok(platformMinor !== undefined && platformMinor < 113_000);
    const set = (await assistantLog(scene)).filter(
      (event) => event.name === 'assistant_budget_set',
    );
    assert.deepEqual(
      set.map((event) => event.evidence),
      [{ monthlyMinor: 5000 }, { monthlyMinor: 1000 }, { monthlyMinor: 5000 }],
    );
    return { state: { raised, pooled, platformMinor } };
  },
});
