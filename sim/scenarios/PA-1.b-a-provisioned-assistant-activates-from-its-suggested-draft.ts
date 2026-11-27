import assert from 'node:assert/strict';
import { assistantIdentityOf } from '@uw/contracts';
import {
  assistantLog,
  beginTurn,
  grantAssist,
  provisionFor,
  requestId,
  seedAssistantPersona,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { readSpend, simPerson, simRowan } from '../fixtures.ts';
import { activatePersona, failuresIn, pageStatus } from '../persona-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const draftPageId = '00000000-0000-4000-8000-000000012201';

export const scenario = defineScenario({
  id: 'PA-1',
  title:
    'a provisioned assistant left as a suggested persona draft activates through the normal persona activation, passes its dry run, and then answers a turn',
  run: async (world) => {
    const rowan = await simRowan(world);
    const person = await simPerson(world, 5, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
    ]);
    const { harness } = value(await provisionFor(world, rowan, person));
    await seedAssistantPersona(world, harness, rowan, { id: draftPageId, status: 'suggested' });
    const activated = value(await activatePersona(world, rowan, draftPageId));
    assert.equal(activated.persona, assistantIdentityOf(personOf(person)));
    assert.equal(await pageStatus(world, draftPageId), 'active');
    const scene: AssistantScene = { world, rowan, person, harness, pageId: draftPageId };
    const log = await assistantLog(scene);
    assert.deepEqual(failuresIn(log), []);
    value(await grantAssist(world, person, harness.id));
    await readSpend(world);
    const id = await requestId(scene, { externalId: 'zulip:draft-1', note: 'What is due today?' });
    const begun = value(await beginTurn(scene, id));
    assert.equal(begun.loop.persona, activated.persona);
    return {
      state: {
        page: await pageStatus(world, draftPageId),
        events: (await assistantLog(scene)).map((event) => event.name),
      },
    };
  },
});
