import assert from 'node:assert/strict';
import { assistantIdentityOf } from '@uw/contracts';
import { ASSISTANT_VERBS, assistantRole } from '@uw/harness';
import {
  assistantLog,
  assistantNames,
  beginTurn,
  finishTurn,
  grantedScene,
  recordRequest,
  replyWith,
  requestId,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const firstNote = "What's on my schedule today?";
const firstReply = 'You have nothing booked.';
const secondNote = 'And tomorrow?';

async function recordsOnce(scene: AssistantScene): Promise<string> {
  const change = { externalId: '101', note: firstNote };
  const first = value(await recordRequest(scene, change));
  assert.equal(first.created, true);
  const again = value(await recordRequest(scene, change));
  assert.deepEqual(again, { requestId: first.requestId, created: false });
  return first.requestId;
}

async function firstTurn(scene: AssistantScene, id: string) {
  const turn = value(await beginTurn(scene, id));
  assert.equal(turn.principal.identity, assistantIdentityOf(personOf(scene.person)));
  assert.ok(turn.principal.grants.length > 0);
  assert.ok(turn.principal.grants.every((grant) => grant.role === 'viewer'));
  assert.deepEqual(turn.loop.tools, [...assistantRole.toolset, ...ASSISTANT_VERBS]);
  assert.ok(turn.loop.prompt.includes(firstNote));
  assert.deepEqual(turn.loop.history, []);
  return turn;
}

async function repliedOnlyToThePerson(scene: AssistantScene, id: string): Promise<void> {
  const sent = scene.world.adapters.directMessages.sent();
  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.equal(message?.requestId, id);
  assert.equal(message?.personId, personOf(scene.person));
  assert.equal(message?.channel, 'zulip_dm');
  assert.equal(message?.replyAddress, 'zulip:5005');
  assert.equal(message?.text, firstReply);
}

async function contentFreeLog(scene: AssistantScene): Promise<readonly string[]> {
  const events = await assistantLog(scene);
  const names = assistantNames(events);
  assert.deepEqual(names, [
    'assistant_request_recorded',
    'assistant_turn_started',
    'assistant_effect_started',
    'assistant_effect_done',
    'assistant_turn_finished',
  ]);
  for (const event of events) {
    const evidence = JSON.stringify(event.evidence);
    assert.ok(!evidence.includes(firstNote), `${event.name} carries the note`);
    assert.ok(!evidence.includes(firstReply), `${event.name} carries the reply`);
  }
  return names;
}

async function noWorkflowRows(scene: AssistantScene): Promise<void> {
  const harnessId = scene.harness.id;
  const since = new Date(0);
  const rows = await scene.world.adapters.store.transaction(async (tx) => ({
    items: await tx.harnessItems.read.forHarness(harnessId),
    runs: await tx.harnessRuns.read.recent(harnessId, 10),
    decisions: await tx.gateDecisions.read.decidedPerDay([harnessId], since),
  }));
  assert.deepEqual(rows, { items: [], runs: [], decisions: [] });
}

async function strangerAddressGetsNothing(scene: AssistantScene): Promise<void> {
  const change = {
    externalId: '103',
    note: secondNote,
    threadKey: 'elsewhere',
    replyAddress: 'zulip:6006',
  };
  const id = await requestId(scene, change);
  const turn = value(await beginTurn(scene, id));
  scene.world.adapters.modelEngine.respondNextWith(replyWith(firstReply, 20_000));
  await finishTurn(scene, id, turn);
  assert.equal(scene.world.adapters.directMessages.sent().length, 1);
  const failed = (await assistantLog(scene)).filter(
    (event) => event.name === 'assistant_effect_failed',
  );
  assert.deepEqual(
    failed.map((event) => event.evidence['why']),
    ['not_paired'],
  );
}

async function threadCarriesHistory(scene: AssistantScene): Promise<void> {
  const id = await requestId(scene, { externalId: '102', note: secondNote });
  const turn = value(await beginTurn(scene, id));
  assert.deepEqual(turn.loop.history, [
    { role: 'user', text: firstNote },
    { role: 'assistant', text: firstReply, toolCalls: [] },
  ]);
  assert.ok(turn.loop.prompt.includes(secondNote));
  assert.ok(!turn.loop.prompt.includes(firstNote));
}

export const scenario = defineScenario({
  id: 'PA-2',
  title:
    "a person's direct message is recorded once, answered by one turn under viewer-clamped grants with the assistant toolset, and the reply goes only to the owner's verified binding, never to an address that is not it; the log carries neither the note nor the reply, no item, run or gate decision is made, and the next request in the thread carries the earlier exchange",
  run: async (world) => {
    const scene = await grantedScene(world);
    const id = await recordsOnce(scene);
    const turn = await firstTurn(scene, id);
    world.adapters.modelEngine.respondNextWith(replyWith(firstReply, 20_000));
    await finishTurn(scene, id, turn);
    await repliedOnlyToThePerson(scene, id);
    const names = await contentFreeLog(scene);
    await noWorkflowRows(scene);
    await strangerAddressGetsNothing(scene);
    await threadCarriesHistory(scene);
    return { state: { events: names, sent: world.adapters.directMessages.sent().length } };
  },
});
