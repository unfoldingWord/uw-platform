import assert from 'node:assert/strict';
import {
  assistantLog,
  assistantNames,
  grantedScene,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import {
  cancelReminder,
  closeTurn,
  DAY_MS,
  dueIn,
  fireDue,
  listReminders,
  openTurn,
  setReminder,
} from '../assistant-reminder-fixtures.ts';
import { readSpend, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const reportText = 'Send the quarterly report';
const lunchText = 'Book lunch with Ana';

async function twoReminders(scene: AssistantScene): Promise<string> {
  const open = await openTurn(scene, { externalId: '501', note: 'Remind me in 60 days' });
  value(await setReminder(scene, open, reportText, dueIn(scene, 60 * DAY_MS)));
  value(await setReminder(scene, open, lunchText, dueIn(scene, 30 * DAY_MS)));
  await closeTurn(scene, open);
  const later = await openTurn(scene, { externalId: '502', note: 'Cancel the lunch one' });
  const pending = value(await listReminders(scene, later)).reminders;
  assert.deepEqual(
    pending.map((entry) => entry.text),
    [lunchText, reportText],
  );
  const lunch = pending.find((entry) => entry.text === lunchText);
  assert.ok(lunch);
  value(await cancelReminder(scene, later, lunch.reminderId));
  await closeTurn(scene, later);
  return lunch.reminderId;
}

async function refusesTheWindow(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '503', note: 'Remind me yesterday' });
  const past = await setReminder(scene, open, 'Yesterday', dueIn(scene, -DAY_MS));
  assert.equal(past.status === 'error' && past.detail['why'], 'due_in_past');
  const far = await setReminder(scene, open, 'In three years', dueIn(scene, 3 * 365 * DAY_MS));
  assert.equal(far.status === 'error' && far.detail['why'], 'due_too_far');
  await closeTurn(scene, open);
}

async function firesOnceToMe(scene: AssistantScene): Promise<number> {
  const { directMessages, clock } = scene.world.adapters;
  const before = directMessages.sent().length;
  clock.advance(61 * DAY_MS);
  const first = value(await fireDue(scene));
  assert.equal(first.fired.length, 1);
  const again = value(await fireDue(scene));
  assert.deepEqual(again, { fired: [], undelivered: [] });
  const sent = directMessages.sent().slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.personId, personOf(scene.person));
  assert.equal(sent[0]?.replyAddress, 'zulip:5005');
  assert.ok(sent[0]?.text.includes(reportText));
  assert.ok(!sent.some((message) => message.text.includes(lunchText)));
  return sent.length;
}

async function lapsedIsUndelivered(scene: AssistantScene): Promise<void> {
  await readSpend(scene.world);
  const open = await openTurn(scene, { externalId: '504', note: 'Remind me tomorrow' });
  value(await setReminder(scene, open, 'Water the plants', dueIn(scene, DAY_MS)));
  await closeTurn(scene, open);
  const granted = (await assistantLog(scene)).find((event) => event.name === 'delegation_granted');
  const delegationId = String(granted?.evidence['delegationId']);
  const { world, person } = scene;
  value(await world.kernel.delegations.revoke(simCaller(world, person), { delegationId }));
  const before = world.adapters.directMessages.sent().length;
  world.adapters.clock.advance(2 * DAY_MS);
  const fired = value(await fireDue(scene));
  assert.equal(fired.undelivered.length, 1);
  assert.equal(world.adapters.directMessages.sent().length, before);
  const undelivered = (await assistantLog(scene)).find(
    (event) => event.name === 'assistant_reminder_undelivered',
  );
  assert.equal(undelivered?.evidence['why'], 'delegation_lapsed');
}

async function contentFree(scene: AssistantScene): Promise<readonly string[]> {
  const events = await assistantLog(scene);
  for (const event of events) {
    const evidence = JSON.stringify(event.evidence);
    assert.ok(!evidence.includes(reportText), `${event.name} carries the reminder text`);
  }
  return assistantNames(events).filter((name) => name.startsWith('assistant_reminder_'));
}

export const scenario = defineScenario({
  id: 'PA-5',
  title:
    'a reminder drafted in a turn is set when the turn ends, fires once at its time and reaches only its person; a cancelled one never fires, a due time in the past or more than two years ahead is refused, and a reminder due after the assist delegation lapsed is recorded undelivered and sends nothing',
  run: async (world) => {
    const scene = await grantedScene(world);
    await twoReminders(scene);
    await refusesTheWindow(scene);
    const sent = await firesOnceToMe(scene);
    await lapsedIsUndelivered(scene);
    const events = await contentFree(scene);
    return { state: { sent, events } };
  },
});
