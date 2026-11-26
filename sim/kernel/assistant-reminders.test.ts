import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assistantLog,
  assistantNames,
  grantedScene,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import {
  closeTurn,
  DAY_MS,
  dueIn,
  fireDue,
  listReminders,
  MINUTE_MS,
  openTurn,
  setReminder,
  type OpenTurn,
} from '../assistant-reminder-fixtures.ts';
import { simCaller, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { personOf } from '../wakes.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await grantedScene(world));
  } finally {
    await world.close();
  }
}

function why(outcome: KernelOutcome<unknown>): unknown {
  return outcome.status === 'error' ? outcome.detail['why'] : undefined;
}

async function names(scene: AssistantScene): Promise<readonly string[]> {
  return assistantNames(await assistantLog(scene));
}

async function pendingIds(scene: AssistantScene, open: OpenTurn): Promise<readonly string[]> {
  return value(await listReminders(scene, open)).reminders.map((entry) => entry.reminderId);
}

async function setOnFinish(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '801', note: 'Remind me in 60 days' });
  const drafted = value(
    await setReminder(scene, open, 'Send the report', dueIn(scene, 60 * DAY_MS)),
  );
  expect(drafted.status).toBe('drafted');
  expect(await pendingIds(scene, open)).toEqual([]);
  await closeTurn(scene, open);
  const log = await assistantLog(scene);
  const set = log.find((event) => event.name === 'assistant_reminder_set');
  expect(set?.evidence['effectId']).toBe(drafted.effectId);
  const done = log.filter((event) => event.name === 'assistant_effect_done');
  expect(done.map((event) => event.evidence['kind'])).toEqual([
    'reminder_set',
    'reply_to_requester',
  ]);
  expect(JSON.stringify(log.map((event) => event.evidence))).not.toContain('Send the report');
  const later = await openTurn(scene, { externalId: '802', note: 'What is pending?' });
  const listed = value(await listReminders(scene, later)).reminders;
  expect(listed.map((entry) => entry.text)).toEqual(['Send the report']);
}

async function refusesTheWindow(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '811', note: 'Remind me' });
  const past = await setReminder(scene, open, 'Too soon', dueIn(scene, 30_000));
  expect(past.status === 'error' && past.reason).toBe('malformed_command');
  expect(why(past)).toBe('due_in_past');
  const far = await setReminder(scene, open, 'Too far', dueIn(scene, 732 * DAY_MS));
  expect(why(far)).toBe('due_too_far');
  value(await setReminder(scene, open, 'Just inside', dueIn(scene, 700 * DAY_MS)));
  value(await setReminder(scene, open, 'One minute', dueIn(scene, MINUTE_MS)));
}

async function onlyTheTurnsAssistant(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '821', note: 'Remind me' });
  const { world, person } = scene;
  const asPerson = await world.kernel.assistants.setReminder(simCaller(world, person), {
    requestId: open.id,
    turnId: open.turn.turnId,
    text: 'From the person',
    dueAt: dueIn(scene, DAY_MS),
  });
  expect(asPerson.status === 'error' && asPerson.reason).toBe('not_permitted');
  const asSystem = await world.kernel.assistants.setReminder(simCaller(world, simSystem()), {
    requestId: open.id,
    turnId: open.turn.turnId,
    text: 'From the system',
    dueAt: dueIn(scene, DAY_MS),
  });
  expect(asSystem.status === 'error' && asSystem.reason).toBe('not_permitted');
  await closeTurn(scene, open);
  const late = await setReminder(scene, open, 'After the turn', dueIn(scene, DAY_MS));
  expect(late.status === 'error' && late.reason).toBe('stale_version');
  expect(await names(scene)).not.toContain('assistant_reminder_set');
}

async function capsPerRequest(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '831', note: 'Remind me often' });
  for (let n = 1; n <= 5; n += 1) {
    value(await setReminder(scene, open, `Reminder ${String(n)}`, dueIn(scene, n * DAY_MS)));
  }
  const sixth = await setReminder(scene, open, 'Reminder 6', dueIn(scene, 6 * DAY_MS));
  expect(why(sixth)).toBe('effects_capped');
  const again = value(await setReminder(scene, open, 'Reminder 1', dueIn(scene, DAY_MS)));
  expect(again.status).toBe('drafted');
}

async function capsPerDay(scene: AssistantScene): Promise<void> {
  for (let r = 0; r < 10; r += 1) {
    const open = await openTurn(scene, { externalId: `84${String(r)}`, note: 'Remind me' });
    for (let n = 1; n <= 5; n += 1) {
      value(
        await setReminder(scene, open, `R ${String(r)} ${String(n)}`, dueIn(scene, n * DAY_MS)),
      );
    }
    await closeTurn(scene, open);
  }
  const open = await openTurn(scene, { externalId: '850', note: 'One more' });
  const over = await setReminder(scene, open, 'The fifty-first', dueIn(scene, DAY_MS));
  expect(why(over)).toBe('reminders_capped');
}

async function firesOnce(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '861', note: 'Remind me' });
  value(await setReminder(scene, open, 'Call Ana', dueIn(scene, 60 * DAY_MS)));
  await closeTurn(scene, open);
  const { directMessages, clock } = scene.world.adapters;
  const replies = directMessages.sent().length;
  expect(value(await fireDue(scene)).fired).toEqual([]);
  clock.advance(60 * DAY_MS);
  const first = value(await fireDue(scene));
  expect(first.fired).toHaveLength(1);
  const sent = directMessages.sent().slice(replies);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.personId).toBe(personOf(scene.person));
  expect(sent[0]?.replyAddress).toBe('zulip:5005');
  expect(sent[0]?.text).toContain('Call Ana');
  expect(value(await fireDue(scene)).fired).toEqual([]);
  expect(directMessages.sent().slice(replies)).toHaveLength(1);
  expect((await names(scene)).filter((name) => name === 'assistant_reminder_fired')).toHaveLength(
    1,
  );
}

async function undeliveredWhenLapsed(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '871', note: 'Remind me' });
  value(await setReminder(scene, open, 'Call Ana', dueIn(scene, 2 * DAY_MS)));
  await closeTurn(scene, open);
  const { world, person } = scene;
  const granted = (await assistantLog(scene)).find((event) => event.name === 'delegation_granted');
  const delegationId = String(granted?.evidence['delegationId']);
  value(await world.kernel.delegations.revoke(simCaller(world, person), { delegationId }));
  const replies = world.adapters.directMessages.sent().length;
  world.adapters.clock.advance(3 * DAY_MS);
  const fired = value(await fireDue(scene));
  expect(fired.undelivered).toHaveLength(1);
  expect(world.adapters.directMessages.sent()).toHaveLength(replies);
  const undelivered = (await assistantLog(scene)).find(
    (event) => event.name === 'assistant_reminder_undelivered',
  );
  expect(undelivered?.evidence['why']).toBe('delegation_lapsed');
  expect(value(await fireDue(scene)).undelivered).toEqual([]);
}

async function undeliveredWhenNotPaired(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, {
    externalId: '881',
    note: 'Remind me',
    threadKey: 'other',
    replyAddress: 'zulip:6006',
  });
  value(await setReminder(scene, open, 'Call Ana', dueIn(scene, DAY_MS)));
  await closeTurn(scene, open);
  scene.world.adapters.clock.advance(2 * DAY_MS);
  const fired = value(await fireDue(scene));
  expect(fired.undelivered).toHaveLength(1);
  const undelivered = (await assistantLog(scene)).find(
    (event) => event.name === 'assistant_reminder_undelivered',
  );
  expect(undelivered?.evidence['why']).toBe('not_paired');
}

async function onlyTheSystemFires(scene: AssistantScene): Promise<void> {
  const { world, person } = scene;
  const refused = await world.kernel.assistants.fireDueReminders(simCaller(world, person), {
    limit: 50,
  });
  expect(refused.status === 'error' && refused.reason).toBe('not_permitted');
}

describe('PA-5 a reminder is drafted in a turn, set at its end and fired once to its person', () => {
  it('drafts a reminder in the turn and sets it only when the turn finishes, with no text in the log', () =>
    withScene(setOnFinish));

  it('refuses a due time less than a minute ahead or more than two years ahead', () =>
    withScene(refusesTheWindow));

  it("refuses a reminder from anyone but the turn's own assistant, and after the turn", () =>
    withScene(onlyTheTurnsAssistant));

  it('caps a request at five reminders and treats a repeated draft as the same one', () =>
    withScene(capsPerRequest));

  it('caps an assistant at fifty reminders a day', () => withScene(capsPerDay));

  it('fires a due reminder once, to its person only, and never again', () => withScene(firesOnce));

  it('records a reminder undelivered, sending nothing, when the assist delegation lapsed', () =>
    withScene(undeliveredWhenLapsed));

  it('records the delivery failure when the address is not the verified binding', () =>
    withScene(undeliveredWhenNotPaired));

  it('fires reminders only for the system', () => withScene(onlyTheSystemFires));
});
