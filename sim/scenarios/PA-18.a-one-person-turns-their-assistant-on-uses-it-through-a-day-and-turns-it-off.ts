import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { runToolLoop, type ToolCaller } from '@uw/harness';
import {
  accountEvents,
  disable,
  enable,
  passDays,
  retire,
  simProvisioner,
  staffPerson,
} from '../assistant-account-fixtures.ts';
import {
  holdTime,
  inHours,
  inTimezone,
  readCalendar,
  seedEvent,
} from '../assistant-calendar-fixtures.ts';
import {
  assistantLog,
  assistantNames,
  beginTurn,
  grantAssist,
  recordRequest,
  refusedWhy,
  replyWith,
  seedAssistantPersona,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import { decide, proposeEmail } from '../assistant-proposal-fixtures.ts';
import {
  DAY_MS,
  dueIn,
  fireDue,
  openTurn,
  setReminder,
  type OpenTurn,
} from '../assistant-reminder-fixtures.ts';
import { readSpend, simCaller, simRowan, simSystem } from '../fixtures.ts';
import { inboundMail, MAIL_OWNER } from '../mail-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';
import type { World } from '../world.ts';

const personaPage = '00000000-0000-4000-8000-000000018001';
const zulipAddress = 'zulip:5061';
const mailbox = 'barnabas@unfoldingword.org';
const noTools: ToolCaller = {
  call: async () => ({ output: { error: 'not_wired' }, isError: true }),
};

async function turnedOn(world: World, ana: Principal): Promise<AssistantScene> {
  const on = value(await enable(world, ana, 'barnabas'));
  assert.equal(on.jdId, '10.51');
  const harness = await world.adapters.store.transaction((tx) =>
    tx.harnesses.read.byId(on.harnessId),
  );
  assert.ok(harness);
  await seedAssistantPersona(world, harness, ana, { id: personaPage, status: 'suggested' });
  const provisioner = simCaller(world, simProvisioner());
  const input = { harnessId: harness.id, pageId: personaPage, expectedVersion: 1 };
  value(await world.kernel.assistants.activatePersona(provisioner, input));
  const personId = personOf(ana);
  for (const [channel, address] of [
    ['zulip_dm', zulipAddress],
    ['email', MAIL_OWNER],
  ] as const) {
    value(await world.kernel.assistants.bindAddress(provisioner, { personId, channel, address }));
    world.adapters.directMessages.bind(personId, channel, address);
  }
  world.adapters.workspace.addPerson(personId, 'person61@unfoldingword.org');
  world.adapters.workspace.addMailbox(harness.id, mailbox);
  value(
    await world.kernel.assistants.recordProvisioning(provisioner, {
      harnessId: harness.id,
      done: 'enabled',
    }),
  );
  value(await grantAssist(world, ana, harness.id));
  await readSpend(world);
  return { world, rowan: await simRowan(world), person: ana, harness, pageId: personaPage };
}

async function answer(scene: AssistantScene, open: OpenTurn, text: string): Promise<void> {
  const { world } = scene;
  world.adapters.modelEngine.respondNextWith(replyWith(text, 10_000));
  const result = await runToolLoop(
    world.adapters.modelEngine.turn,
    noTools,
    open.turn.loop,
    async () => undefined,
  );
  const input = { requestId: open.id, turnId: open.turn.turnId, result };
  value(await world.kernel.assistants.finishTurn(simCaller(world, simSystem()), input));
}

function sentTexts(scene: AssistantScene): readonly string[] {
  return scene.world.adapters.directMessages
    .sent()
    .map((message) => `${message.replyAddress} ${message.text}`);
}

async function scheduleToday(scene: AssistantScene): Promise<void> {
  await inTimezone(scene, 'Europe/Berlin');
  seedEvent(scene, 'Translation review', '2026-10-01T13:00:00.000Z', 1);
  const open = await openTurn(scene, {
    externalId: '1801',
    note: 'What is on my schedule today?',
    replyAddress: zulipAddress,
  });
  const read = value(await readCalendar(scene, open));
  assert.deepEqual(
    read.events.map((event) => event.when),
    ['2026-10-01 15:00 to 16:00'],
  );
  await answer(scene, open, 'Today you have Translation review from 15:00 to 16:00.');
  assert.deepEqual(sentTexts(scene), [
    `${zulipAddress} Today you have Translation review from 15:00 to 16:00.`,
  ]);
}

async function reminderFires(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, {
    externalId: '1802',
    note: 'Remind me tomorrow to call Ben',
    replyAddress: zulipAddress,
  });
  value(await setReminder(scene, open, 'Call Ben', dueIn(scene, DAY_MS)));
  await answer(scene, open, 'I will remind you tomorrow.');
  scene.world.adapters.clock.advance(DAY_MS + 60_000);
  assert.equal(value(await fireDue(scene)).fired.length, 1);
  assert.deepEqual(value(await fireDue(scene)), { fired: [], undelivered: [] });
  assert.equal(sentTexts(scene).filter((text) => text.includes('Call Ben')).length, 1);
}

async function holdPlaced(scene: AssistantScene): Promise<void> {
  await readSpend(scene.world);
  const open = await openTurn(scene, {
    externalId: '1803',
    note: 'Block two hours tomorrow morning',
    replyAddress: zulipAddress,
  });
  value(
    await holdTime(scene, open, {
      title: 'Focus on Ruth 2',
      start: inHours(scene, 20),
      end: inHours(scene, 22),
    }),
  );
  await answer(scene, open, 'I held two hours tomorrow morning.');
  const holds = scene.world.adapters.workspace
    .events(personOf(scene.person))
    .filter((event) => event.hold !== null);
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0]?.attendees, []);
  assert.equal(holds[0]?.notified, false);
}

async function forwardedMailAnswered(scene: AssistantScene): Promise<void> {
  const { world } = scene;
  const mail = inboundMail('forwarded-with-attachment');
  const admitted = await world.kernel.assistants.admitMail(simCaller(world, simSystem()), {
    personId: personOf(scene.person),
    mail,
    instructions: 'on',
  });
  const { requestId } = value(admitted);
  const turn = value(await beginTurn(scene, requestId));
  assert.ok(turn.loop.prompt.includes('What do these notes ask of me?'));
  await answer(scene, { id: requestId, turn }, 'The notes ask you to confirm the meeting.');
  const last = world.adapters.directMessages.sent().at(-1);
  assert.deepEqual(
    [last?.channel, last?.replyAddress, last?.threadKey],
    ['email', MAIL_OWNER, mail.threadKey],
  );
}

async function proposalAccepted(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, {
    externalId: '1805',
    note: 'Tell Ben I can meet on Friday',
    replyAddress: zulipAddress,
  });
  const mail = { to: ['ben@unfoldingword.org'], subject: 'Friday', body: 'I can meet on Friday.' };
  const { proposalId } = value(await proposeEmail(scene, open, mail));
  await answer(scene, open, 'I drafted an email to Ben for you to accept.');
  assert.equal(scene.world.adapters.workspace.mails().length, 0);
  value(await decide(scene, scene.person, proposalId, 'accept'));
  assert.equal(scene.world.adapters.workspace.mails().length, 1);
}

async function turnedOff(scene: AssistantScene): Promise<string> {
  const { world } = scene;
  value(await disable(world, scene.person));
  await readSpend(world);
  const before = world.adapters.directMessages.sent().length;
  const late = value(
    await recordRequest(scene, {
      externalId: '1806',
      note: 'Are you there?',
      replyAddress: zulipAddress,
    }),
  );
  const refused = await beginTurn(scene, late.requestId);
  assert.equal(refusedWhy(refused, await assistantLog(scene)), 'delegation_required');
  assert.equal(world.adapters.directMessages.sent().length, before);
  passDays(world, 30);
  return value(await retire(world, scene.harness.id)).jdId;
}

export const scenario = defineScenario({
  id: 'PA-18',
  title:
    'one person turns their assistant on with a name and gets 10.51, its persona, its Zulip and email bindings and their assist grant; it answers what is on their calendar today in their timezone, sets a reminder that reaches them once, holds time privately, answers forwarded mail by email on the thread, sends an email only after they accept the proposal, and once turned off takes no turn and, 30 days later, frees its number',
  run: async (world) => {
    const ana = await staffPerson(world, 61);
    const scene = await turnedOn(world, ana);
    await scheduleToday(scene);
    await reminderFires(scene);
    await holdPlaced(scene);
    await forwardedMailAnswered(scene);
    await proposalAccepted(scene);
    const freed = await turnedOff(scene);
    const names = assistantNames(await assistantLog(scene));
    const accounts = (await accountEvents(world, scene.harness.id)).map((event) => event.name);
    assert.ok(accounts.includes('assistant_deleted'));
    return { state: { freed, sent: world.adapters.directMessages.sent().length, events: names } };
  },
});
