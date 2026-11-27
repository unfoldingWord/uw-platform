import { assistantRole } from '@uw/harness';
import {
  beginTurn,
  finishTurn,
  grantAssist,
  provisionFor,
  replyWith,
  requestId,
  seedAssistantPersona,
  type AssistantScene,
} from './assistant-fixtures.ts';
import { simCaller, simPerson } from './fixtures.ts';
import { value } from './runs.ts';
import { personOf } from './wakes.ts';

const MICROS_PER_MINOR = 10_000;
export const defaultMinor = assistantRole.budget.monthly_minor;

const secondPageId = '00000000-0000-4000-8000-000000012002';

export async function secondAssistant(scene: AssistantScene): Promise<AssistantScene> {
  const { world, rowan } = scene;
  const person = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const { harness } = value(await provisionFor(world, rowan, person));
  await seedAssistantPersona(world, harness, rowan, { id: secondPageId, status: 'active' });
  world.adapters.directMessages.bind(personOf(person), 'zulip_dm', 'zulip:6006');
  value(await grantAssist(world, person, harness.id));
  return { ...scene, person, harness, pageId: secondPageId };
}

export async function spendMinor(scene: AssistantScene, minor: number): Promise<void> {
  const externalId = `spend-${scene.world.adapters.ids.next()}`;
  const id = await requestId(scene, { externalId, note: 'Spend.' });
  const turn = value(await beginTurn(scene, id));
  scene.world.adapters.modelEngine.respondNextWith(replyWith('Spent.', minor * MICROS_PER_MINOR));
  await finishTurn(scene, id, turn);
}

export function setBudget(
  scene: AssistantScene,
  by: AssistantScene['person'],
  monthlyMinor: number | null,
) {
  return scene.world.kernel.assistants.setBudget(simCaller(scene.world, by), {
    personId: personOf(scene.person),
    monthlyMinor,
  });
}
