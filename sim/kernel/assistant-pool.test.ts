import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { KernelSettings } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
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
import { readSpend, simCaller, simSystem } from '../fixtures.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function withScene(
  work: (scene: AssistantScene) => Promise<void>,
  settings: Partial<KernelSettings> = {},
): Promise<void> {
  const world = await createWorld(undefined, settings);
  try {
    await work(await grantedScene(world));
  } finally {
    await world.close();
  }
}

async function admission(scene: AssistantScene, externalId: string): Promise<unknown> {
  const id = await requestId(scene, { externalId, note: 'Summarise my week.' });
  const outcome = await beginTurn(scene, id);
  if (outcome.status === 'accepted') return 'accepted';
  return refusedWhy(outcome, await assistantLog(scene));
}

async function budgetChanges(scene: AssistantScene): Promise<readonly unknown[]> {
  const events = await assistantLog(scene);
  return events.filter((e) => e.name === 'assistant_budget_set').map((e) => e.evidence);
}

async function raised(scene: AssistantScene): Promise<void> {
  await spendMinor(scene, defaultMinor + 100);
  expect(await admission(scene, '1601')).toBe('assistant_budget_spent');
  const set = await setBudget(scene, scene.rowan, 5000);
  expect(set.status).toBe('accepted');
  expect(await admission(scene, '1602')).toBe('accepted');
  expect(await budgetChanges(scene)).toEqual([{ monthlyMinor: 5000 }]);
}

async function refusedToOthers(scene: AssistantScene): Promise<void> {
  const own = await setBudget(scene, scene.person, 9000);
  expect(own).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const system = await scene.world.kernel.assistants.setBudget(
    simCaller(scene.world, simSystem()),
    { personId: scene.person.personId ?? '', monthlyMinor: 9000 },
  );
  expect(system).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await budgetChanges(scene)).toEqual([]);
}

describe('PA-16 an admin sets one assistant budget', () => {
  it('admits a turn the default budget would refuse once an admin raises it', () =>
    withScene(raised));

  it('goes back to the role default when the admin clears the budget', async () => {
    await withScene(async (scene) => {
      await spendMinor(scene, defaultMinor + 100);
      expect((await setBudget(scene, scene.rowan, 5000)).status).toBe('accepted');
      expect((await setBudget(scene, scene.rowan, null)).status).toBe('accepted');
      expect(await admission(scene, '1603')).toBe('assistant_budget_spent');
    });
  });

  it('refuses the person themself and a stranger to the platform admin role', () =>
    withScene(refusedToOthers));
});

describe('PA-16 every assistant together spends one pool outside the platform cap', () => {
  it('refuses assistants_capped once the pool is spent, though the own budget has room', async () => {
    await withScene(async (scene) => {
      const second = await secondAssistant(scene);
      expect((await setBudget(scene, scene.rowan, 5000)).status).toBe('accepted');
      await spendMinor(scene, 4000);
      expect(await admission(second, '1604')).toBe('accepted');
      expect((await setBudget(scene, scene.rowan, 1000)).status).toBe('accepted');
      expect(await admission(second, '1605')).toBe('assistants_capped');
      expect((await setBudget(scene, scene.rowan, 5000)).status).toBe('accepted');
      expect(await admission(second, '1606')).toBe('accepted');
    });
  });

  it('holds the pool under the optional ceiling below the sum of budgets', async () => {
    await withScene(
      async (scene) => {
        await spendMinor(scene, 600);
        expect(await admission(scene, '1607')).toBe('assistants_capped');
      },
      { assistantSpendCapMinor: 600 },
    );
  });

  it('leaves assistant spend out of the platform spend breaker reading', async () => {
    await withScene(async (scene) => {
      const { world } = scene;
      await spendMinor(scene, 1500);
      world.adapters.modelEngine.setSpend({ spentMinor: 113_000, currency: 'USD' });
      await readSpend(world);
      const state = await world.kernel.breaker.state(world.adapters.clock.now());
      expect(state.reading?.spentMinor).toBe(111_500);
      expect(state.level).toBe('holding');
    });
  });
});
