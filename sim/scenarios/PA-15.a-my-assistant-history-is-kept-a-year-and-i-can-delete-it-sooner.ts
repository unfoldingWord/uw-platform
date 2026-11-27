import assert from 'node:assert/strict';
import {
  assistantLog,
  grantAssist,
  grantedScene,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { closeTurn, DAY_MS, openTurn } from '../assistant-reminder-fixtures.ts';
import { readSpend, simCaller, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const oldText = 'What did I agree with Ana last year?';
const newText = 'What is on today?';

async function ask(scene: AssistantScene, externalId: string, note: string): Promise<void> {
  await closeTurn(scene, await openTurn(scene, { externalId, note }));
}

function notes(scene: AssistantScene) {
  const { world, person } = scene;
  return world.kernel.views
    .myAssistant(simCaller(world, person), { personId: null })
    .then((seen) => value(seen).requests.map((request) => request.note));
}

async function nightlyRedactsTheOldYear(scene: AssistantScene): Promise<number> {
  const { world } = scene;
  await ask(scene, '1501', oldText);
  world.adapters.clock.advance(300 * DAY_MS);
  value(await grantAssist(world, scene.person, scene.harness.id));
  await readSpend(world);
  await ask(scene, '1502', newText);
  world.adapters.clock.advance(66 * DAY_MS);
  const swept = value(
    await world.kernel.assistants.redactHistory(simCaller(world, simSystem()), {}),
  );
  assert.deepEqual(await notes(scene), [newText, '']);
  return swept.requests;
}

async function iDeleteTheRest(scene: AssistantScene): Promise<number> {
  const { world, person } = scene;
  const wiped = value(await world.kernel.assistants.redactHistory(simCaller(world, person), {}));
  assert.deepEqual(await notes(scene), ['', '']);
  return wiped.requests;
}

export const scenario = defineScenario({
  id: 'PA-15',
  title:
    'request text and replies are redacted a year after they were recorded by the nightly sweep, the person can delete their own history sooner, and the content-free events stay',
  run: async (world) => {
    const scene = await grantedScene(world);
    const byRetention = await nightlyRedactsTheOldYear(scene);
    const byPerson = await iDeleteTheRest(scene);
    const log = await assistantLog(scene);
    const text = JSON.stringify(log);
    assert.ok(!text.includes(oldText) && !text.includes(newText));
    const recorded = log.filter((event) => event.name === 'assistant_request_recorded').length;
    const redacted = log
      .filter((event) => event.name === 'assistant_history_redacted')
      .map((event) => event.evidence['why']);
    assert.deepEqual(redacted, ['retention', 'person']);
    return { state: { byRetention, byPerson, recorded, redacted } };
  },
});
