import assert from 'node:assert/strict';
import { rewritePageStatus } from '@uw/db/test-seed';
import { assistantRole } from '@uw/harness';
import {
  assistantLog,
  assistantScene,
  beginTurn,
  finishTurn,
  grantAssist,
  refusedWhy,
  replyWith,
  requestId,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { readSpend, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const monthlyMinor = assistantRole.budget.monthly_minor;
const wholeBudgetMicros = monthlyMinor * 10_000;
const nextMonth = new Date('2026-11-01T09:00:00.000Z');

async function refusedFor(scene: AssistantScene, externalId: string): Promise<unknown> {
  const { modelEngine } = scene.world.adapters;
  const pending = modelEngine.pending();
  const id = await requestId(scene, { externalId, note: 'Remind me to call Ana.' });
  const outcome = await beginTurn(scene, id);
  const why = refusedWhy(outcome, await assistantLog(scene));
  assert.equal(modelEngine.pending(), pending);
  return why;
}

async function revokedLapses(scene: AssistantScene): Promise<unknown> {
  const { world, person, harness } = scene;
  const granted = value(await grantAssist(world, person, harness.id));
  value(
    await world.kernel.delegations.revoke(simCaller(world, person), { delegationId: granted.id }),
  );
  const why = await refusedFor(scene, '302');
  const lapses = (await assistantLog(scene)).filter(
    (event) => event.name === 'delegation_lapsed' && event.evidence['delegationId'] === granted.id,
  );
  assert.deepEqual(
    lapses.map((event) => event.evidence['why']),
    ['revoked'],
  );
  return why;
}

async function retiredPersona(scene: AssistantScene): Promise<unknown> {
  const { db } = scene.world.database;
  await rewritePageStatus(db, scene.pageId, 'retired');
  const why = await refusedFor(scene, '304');
  await rewritePageStatus(db, scene.pageId, 'active');
  return why;
}

async function spendsTheBudget(scene: AssistantScene): Promise<unknown> {
  const id = await requestId(scene, { externalId: '305', note: 'Summarise my week.' });
  const turn = value(await beginTurn(scene, id));
  const result = await finishTurn(scene, id, turn);
  assert.equal(result.usage.costMicros, wholeBudgetMicros);
  scene.world.adapters.modelEngine.respondNextWith(replyWith('Done.', 20_000));
  return refusedFor(scene, '306');
}

async function nextMonthAnswers(scene: AssistantScene): Promise<void> {
  scene.world.adapters.clock.set(nextMonth);
  await readSpend(scene.world);
  const id = await requestId(scene, { externalId: '307', note: 'Summarise my week.' });
  const turn = value(await beginTurn(scene, id));
  await finishTurn(scene, id, turn);
  assert.equal(scene.world.adapters.modelEngine.pending(), 0);
}

export const scenario = defineScenario({
  id: 'PA-3',
  title:
    'a turn is refused and no model call is made without a delegation, after a revoke, without a fresh spend reading, with the persona retired, or once the month has spent the assistant budget; the next month answers again',
  run: async (world) => {
    const scene = await assistantScene(world);
    world.adapters.modelEngine.respondNextWith(replyWith('Here is your week.', wholeBudgetMicros));
    const whys = [await refusedFor(scene, '301'), await revokedLapses(scene)];
    value(await grantAssist(world, scene.person, scene.harness.id));
    whys.push(await refusedFor(scene, '303'));
    await readSpend(world);
    whys.push(await retiredPersona(scene));
    whys.push(await spendsTheBudget(scene));
    assert.deepEqual(whys, [
      'delegation_required',
      'delegation_required',
      'spend_held',
      'persona_inactive',
      'assistant_budget_spent',
    ]);
    await nextMonthAnswers(scene);
    return { state: { refused: whys, monthlyMinor } };
  },
});
