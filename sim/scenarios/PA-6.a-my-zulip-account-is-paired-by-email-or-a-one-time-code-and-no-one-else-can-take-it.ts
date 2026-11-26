import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { assistantLog, assistantScene, type AssistantScene } from '../assistant-fixtures.ts';
import { simCaller, simIngest, simPerson, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const codeDigest = 'c'.repeat(64);
const wrongDigest = 'd'.repeat(64);

function bindingOf(scene: AssistantScene, harnessId: string) {
  return scene.world.adapters.store.transaction((tx) =>
    tx.assistantBindings.read.of(harnessId, 'zulip_dm'),
  );
}

async function pairedByEmail(scene: AssistantScene): Promise<string> {
  const { world, person } = scene;
  value(
    await world.kernel.assistants.bindAddress(simCaller(world, simSystem()), {
      personId: personOf(person),
      channel: 'zulip_dm',
      address: 'zulip:5005',
    }),
  );
  const binding = await bindingOf(scene, scene.harness.id);
  assert.equal(binding?.via, 'email_match');
  return binding?.address ?? '';
}

async function secondAssistant(scene: AssistantScene): Promise<{ person: Principal; id: string }> {
  const { world } = scene;
  const person = await simPerson(world, 8, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const { harness } = value(
    await world.kernel.assistants.provision(simCaller(world, scene.rowan), {
      harnessId: world.adapters.ids.next(),
      personId: personOf(person),
    }),
  );
  return { person, id: harness.id };
}

async function pairedByCode(scene: AssistantScene): Promise<readonly string[]> {
  const { world } = scene;
  const second = await secondAssistant(scene);
  value(
    await world.kernel.assistants.startPairing(simCaller(world, second.person), {
      harnessId: second.id,
      channel: 'zulip_dm',
      codeDigest,
    }),
  );
  const complete = (address: string, digest: string) =>
    world.kernel.assistants.completePairing(simCaller(world, simIngest()), {
      personId: personOf(second.person),
      channel: 'zulip_dm',
      address,
      codeDigest: digest,
    });
  const answers = [
    await complete('zulip:8008', wrongDigest),
    await complete('zulip:5005', codeDigest),
  ];
  value(
    await world.kernel.assistants.startPairing(simCaller(world, second.person), {
      harnessId: second.id,
      channel: 'zulip_dm',
      codeDigest,
    }),
  );
  answers.push(await complete('zulip:8008', codeDigest));
  assert.equal((await bindingOf(scene, second.id))?.address, 'zulip:8008');
  return answers.map((answer) =>
    answer.status === 'error' ? String(answer.detail['why']) : answer.status,
  );
}

async function contentFree(scene: AssistantScene): Promise<readonly string[]> {
  const events = await assistantLog(scene);
  for (const event of events) {
    const evidence = JSON.stringify(event.evidence);
    assert.ok(!evidence.includes('zulip:5005'), `${event.name} carries the address`);
    assert.ok(!evidence.includes(codeDigest), `${event.name} carries the code`);
  }
  return events.map((event) => event.name).filter((name) => name.includes('pair'));
}

export const scenario = defineScenario({
  id: 'PA-6',
  title:
    "my assistant is paired with my Zulip account by my email when it is provisioned, or by a one-time code I start myself; a wrong or expired code pairs nothing, one Zulip account belongs to one person's assistant, and the pairing events carry neither the code nor the address",
  run: async (world) => {
    const scene = await assistantScene(world);
    const address = await pairedByEmail(scene);
    const answers = await pairedByCode(scene);
    assert.deepEqual(answers, ['pairing_code_wrong', 'address_taken', 'accepted']);
    const events = await contentFree(scene);
    return { state: { address, answers, events } };
  },
});
