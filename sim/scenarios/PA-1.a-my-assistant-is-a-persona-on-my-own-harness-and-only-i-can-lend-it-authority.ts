import assert from 'node:assert/strict';
import { assistantHarnessKey, assistantIdentityOf, type Principal } from '@uw/contracts';
import { createKernel, software, type Delegation } from '@uw/harness';
import {
  ASSISTANTS_AREA,
  assistantLog,
  assistantScene,
  grantAssist,
  provisionFor,
  seedAssistantPersona,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { createSimHarness, simCaller, simPerson, simPersonId, simSystem } from '../fixtures.ts';
import { activatePersona } from '../persona-fixtures.ts';
import { detailOf, reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf, recipientIds } from '../wakes.ts';

const otherPageId = '00000000-0000-4000-8000-000000012101';
const ninetyOneDays = 91 * 24 * 60 * 60 * 1000;

async function provisioned(scene: AssistantScene): Promise<void> {
  const { harness, person, world } = scene;
  assert.equal(harness.template, 'assistant');
  assert.equal(harness.personId, personOf(person));
  assert.equal(harness.key, assistantHarnessKey(personOf(person)));
  assert.equal(harness.jdArea, ASSISTANTS_AREA);
  const stages = await world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(harness.id),
  );
  assert.deepEqual(stages, []);
  const names = (await assistantLog(scene)).map((event) => event.name);
  assert.deepEqual(names, ['template_activated']);
  assert.equal(reasonOf(await provisionFor(world, scene.rowan, person)), 'harness_exists');
}

async function onlyTheConfiguredArea(scene: AssistantScene): Promise<void> {
  const { world, rowan } = scene;
  const otherAdmin = await simPerson(world, 7, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '20-29' },
  ]);
  const target = await simPerson(world, 8, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const attempt = {
    harnessId: world.adapters.ids.next(),
    personId: personOf(target),
    jdArea: '20-29',
  };
  const elsewhere = await world.kernel.assistants.provision(simCaller(world, otherAdmin), attempt);
  assert.equal(reasonOf(elsewhere), 'not_permitted');
  const { harness } = value(await provisionFor(world, rowan, target));
  assert.equal(harness.jdArea, ASSISTANTS_AREA);
  const unconfigured = createKernel(world.adapters).assistants.provision(simCaller(world, rowan), {
    harnessId: world.adapters.ids.next(),
    personId: personOf(await simPerson(world, 9, [])),
  });
  assert.equal(reasonOf(await unconfigured), 'not_wired');
}

async function onlyItsOwnPersona(scene: AssistantScene): Promise<void> {
  const { world, person, harness } = scene;
  for (const persona of ['agent:iterate', assistantIdentityOf(simPersonId(9))]) {
    const outcome = await world.kernel.delegations.grant(simCaller(world, person), {
      harnessId: harness.id,
      persona,
      capability: 'assist',
      maxTier: null,
      expiresAt: null,
      supersedes: null,
    });
    assert.equal(reasonOf(outcome), 'not_permitted');
    assert.deepEqual(detailOf(outcome), { why: 'persona_not_for_harness' });
  }
  const names = (await assistantLog(scene)).map((event) => event.name);
  assert.ok(!names.includes('delegation_granted'));
}

async function onlyThePersonLends(scene: AssistantScene, areaAdmin: Principal) {
  const { world, person, harness } = scene;
  await onlyItsOwnPersona(scene);
  const granted = value(await grantAssist(world, person, harness.id));
  assert.equal(granted.persona, assistantIdentityOf(personOf(person)));
  const names = (await assistantLog(scene)).map((event) => event.name);
  assert.ok(names.includes('delegation_granted'));
  assert.equal(reasonOf(await grantAssist(world, areaAdmin, harness.id)), 'not_permitted');
  const build = await world.kernel.delegations.grant(simCaller(world, person), {
    harnessId: harness.id,
    persona: assistantIdentityOf(personOf(person)),
    capability: 'build',
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  });
  assert.equal(reasonOf(build), 'not_permitted');
  assert.deepEqual(detailOf(build), { why: 'personal_harness' });
  const workflow = await createSimHarness(world, software);
  const onWorkflow = await grantAssist(world, person, workflow.harness.id);
  assert.equal(onWorkflow.status, 'error');
  return granted;
}

async function nothingElseLivesThere(scene: AssistantScene, areaAdmin: Principal): Promise<void> {
  const { world, harness, rowan } = scene;
  const foreign = { ...harness, personId: personOf(areaAdmin) };
  await seedAssistantPersona(world, foreign, rowan, { id: otherPageId, status: 'suggested' });
  const activated = await activatePersona(world, rowan, otherPageId);
  assert.equal(reasonOf(activated), 'not_permitted');
  assert.deepEqual(detailOf(activated), { why: 'persona_not_for_harness' });
  const enqueued = await world.kernel.items.enqueue(simCaller(world, rowan), {
    harnessId: harness.id,
    title: 'Book my flights',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  assert.equal(reasonOf(enqueued), 'stage_not_found');
}

async function beatLeavesItAlone(scene: AssistantScene, delegation: Delegation): Promise<void> {
  const { world } = scene;
  const beaten = value(await world.kernel.runs.beat(simCaller(world, simSystem()), { limit: 5 }));
  assert.deepEqual(beaten.started, []);
  const skipped = beaten.skipped.filter((entry) => entry.delegationId === delegation.id);
  assert.deepEqual(skipped, []);
}

async function lapseWakesOnlyThePerson(scene: AssistantScene, delegation: Delegation) {
  const { world, person } = scene;
  world.adapters.clock.advance(ninetyOneDays);
  const expired = value(
    await world.kernel.delegations.lapseExpired(simCaller(world, simSystem()), { limit: 10 }),
  );
  assert.ok(expired.lapsed.includes(delegation.id));
  const lapses = world.adapters.notifier
    .delivered()
    .filter((wake) => wake.reason === 'delegation_lapsed' && wake.harnessId === scene.harness.id);
  assert.equal(lapses.length, 1);
  const [wake] = lapses;
  assert.equal(wake?.personal, true);
  assert.deepEqual(recipientIds(wake), [personOf(person)]);
  return { personal: wake?.personal ?? null, recipients: recipientIds(wake) };
}

export const scenario = defineScenario({
  id: 'PA-1',
  title:
    'an admin of the configured assistants area provisions one assistant harness per person there, with no stages, and nothing provisions without that setting; only that person can lend it authority, only with assist, only to their own assistant, and only there; no other persona or item can live on it; the run beat leaves it alone; and its lapse wakes only its person',
  run: async (world) => {
    const scene = await assistantScene(world);
    const areaAdmin = await simPerson(world, 6, [
      { role: 'admin', scopeKind: 'jd_area', scopeArea: ASSISTANTS_AREA },
    ]);
    await provisioned(scene);
    await onlyTheConfiguredArea(scene);
    const delegation = await onlyThePersonLends(scene, areaAdmin);
    await nothingElseLivesThere(scene, areaAdmin);
    await beatLeavesItAlone(scene, delegation);
    const lapse = await lapseWakesOnlyThePerson(scene, delegation);
    return {
      state: {
        harness: { template: scene.harness.template, key: scene.harness.key },
        delegation: { capability: delegation.capability, persona: delegation.persona },
        lapse,
      },
    };
  },
});
