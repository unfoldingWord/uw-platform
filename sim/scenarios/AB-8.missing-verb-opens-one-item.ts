import assert from 'node:assert/strict';
import type { HarnessEvent } from '@uw/contracts';
import {
  activatePersona,
  failuresIn,
  harnessItems,
  harnessLog,
  pageStatus,
  personaScene,
  seedPersonaPage,
  type PersonaScene,
} from '../persona-fixtures.ts';
import { defineScenario } from '../scenario.ts';

const pageId = '00000000-0000-4000-8000-000000008201';
const message = 'persona iterate requires verb summarise_measurements, which does not exist';

async function attempt(scene: PersonaScene): Promise<string> {
  const outcome = await activatePersona(scene.world, scene.ian, pageId);
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.reason, 'unknown_verb');
  const { verb, itemId } = outcome.detail;
  assert.equal(verb, 'summarise_measurements');
  assert.equal(outcome.detail.message, message);
  assert.equal(typeof itemId, 'string');
  return String(itemId);
}

function assertFailure(event: HarnessEvent | undefined, itemId: string): void {
  assert.equal(event?.name, 'persona_activation_failed');
  assert.deepEqual(event.evidence, {
    pageId,
    persona: 'agent:iterate',
    verb: 'summarise_measurements',
    engine: null,
    reason: 'unknown_verb',
    message,
    itemId,
  });
}

async function assertOneItem(scene: PersonaScene, itemId: string): Promise<void> {
  const items = await harnessItems(scene.world, scene.softwareId);
  assert.deepEqual(
    items.map((item) => [item.itemId, item.stageKey, item.title, item.pageId]),
    [[itemId, 'package', message, pageId]],
  );
  assert.equal(await pageStatus(scene.world, pageId), 'suggested');
}

export const scenario = defineScenario({
  id: 'AB-8',
  title:
    'activating a persona that needs a missing verb fails with its message as an event, opens one item on the software harness and leaves the persona suggested, and a second attempt opens none',
  run: async (world) => {
    const scene = await personaScene(world);
    await seedPersonaPage(scene, { id: pageId });
    const first = await attempt(scene);
    assertFailure((await harnessLog(world, scene.bmlId)).at(-1), first);
    await assertOneItem(scene, first);
    const second = await attempt(scene);
    assert.equal(second, first);
    const log = await harnessLog(world, scene.bmlId);
    assertFailure(log.at(-1), first);
    await assertOneItem(scene, first);
    const failures = failuresIn(log).length;
    assert.equal(failures, 2);
    return { state: { items: 1, failures } };
  },
});
