import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { holdTime, inHours } from '../assistant-calendar-fixtures.ts';
import {
  assistantLog,
  grantAssist,
  grantedScene,
  type AssistantScene,
} from '../assistant-fixtures.ts';
import {
  closeTurn,
  DAY_MS,
  dueIn,
  fireDue,
  MINUTE_MS,
  openTurn,
  setReminder,
} from '../assistant-reminder-fixtures.ts';
import { readSpend, simCaller, simPerson, simSystem } from '../fixtures.ts';
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

function refusal(outcome: KernelOutcome<unknown>) {
  return outcome.status === 'error'
    ? { reason: outcome.reason, why: outcome.detail['why'] }
    : { reason: 'accepted', why: undefined };
}

function overview(scene: AssistantScene, personId: string | null = null) {
  const { world } = scene;
  return world.kernel.views.myAssistant(simCaller(world, scene.person), { personId });
}

function undo(scene: AssistantScene, effectId: string, actor = scene.person) {
  const { world } = scene;
  return world.kernel.assistants.undoEffect(simCaller(world, actor), { effectId });
}

function redact(scene: AssistantScene, actor = scene.person) {
  const { world } = scene;
  return world.kernel.assistants.redactHistory(simCaller(world, actor), {});
}

async function remindedAndHeld(scene: AssistantScene, externalId = '701') {
  const open = await openTurn(scene, { externalId, note: 'Remind me and hold Friday' });
  const reminder = value(await setReminder(scene, open, 'Call Ana', dueIn(scene, DAY_MS)));
  const hold = value(
    await holdTime(scene, open, {
      title: 'Focus',
      start: inHours(scene, 30),
      end: inHours(scene, 31),
    }),
  );
  await closeTurn(scene, open);
  return { open, reminderEffect: reminder.effectId, holdEffect: hold.effectId };
}

async function showsThePersonTheirAssistant(scene: AssistantScene): Promise<void> {
  const done = await remindedAndHeld(scene);
  const seen = value(await overview(scene));
  expect(seen.self).toBe(true);
  expect(seen.harnessId).toBe(scene.harness.id);
  expect(seen.assist?.expiresAt).toBeInstanceOf(Date);
  expect(seen.budget).toMatchObject({ monthlyMinor: 2000, overridden: false });
  expect(seen.budget.spentMinor).toBeGreaterThan(0);
  expect(seen.requests.map((request) => request.note)).toEqual(['Remind me and hold Friday']);
  const effects = seen.requests[0]?.effects ?? [];
  expect(effects.map((effect) => [effect.kind, effect.state, effect.undoable])).toEqual([
    ['reminder_set', 'done', true],
    ['calendar_hold_added', 'done', true],
    ['reply_to_requester', 'done', false],
  ]);
  expect(seen.reminders.map((reminder) => reminder.text)).toEqual(['Call Ana']);
  expect(seen.holds.map((hold) => [hold.title, hold.effectId])).toEqual([
    ['Focus', done.holdEffect],
  ]);
}

async function showsAnAdminNoContent(scene: AssistantScene): Promise<void> {
  await remindedAndHeld(scene);
  const { world } = scene;
  const admin = world.kernel.views.myAssistant(simCaller(world, scene.rowan), {
    personId: personOf(scene.person),
  });
  const seen = value(await admin);
  expect(seen.self).toBe(false);
  expect(seen.budget.monthlyMinor).toBe(2000);
  expect([seen.requests, seen.reminders, seen.holds, seen.settings]).toEqual([[], [], [], null]);
  const other = await simPerson(world, 7, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const refused = world.kernel.views.myAssistant(simCaller(world, other), {
    personId: personOf(scene.person),
  });
  expect(refusal(await refused).reason).toBe('not_permitted');
}

async function undoesAReminderOnce(scene: AssistantScene): Promise<void> {
  const { reminderEffect } = await remindedAndHeld(scene);
  expect(refusal(await undo(scene, reminderEffect, scene.rowan)).reason).toBe('not_permitted');
  value(await undo(scene, reminderEffect));
  expect(refusal(await undo(scene, reminderEffect))).toEqual({
    reason: 'effect_not_undoable',
    why: 'already_closed',
  });
  scene.world.adapters.clock.advance(DAY_MS + MINUTE_MS);
  expect(value(await fireDue(scene)).fired).toEqual([]);
  const log = await assistantLog(scene);
  const undone = log.filter((event) => event.name === 'assistant_effect_undone');
  expect(undone.map((event) => event.evidence)).toEqual([
    { effectId: reminderEffect, kind: 'reminder_set' },
  ]);
  const seen = value(await overview(scene));
  expect(seen.reminders).toEqual([]);
  expect(seen.requests[0]?.effects[0]).toMatchObject({ state: 'undone', undoable: false });
}

async function undoesAHoldFromTheCalendar(scene: AssistantScene): Promise<void> {
  const { holdEffect } = await remindedAndHeld(scene);
  const calendar = () => scene.world.adapters.workspace.events(personOf(scene.person));
  expect(calendar()).toHaveLength(1);
  const reply = value(await overview(scene)).requests[0]?.effects[2]?.effectId ?? '';
  expect(refusal(await undo(scene, reply))).toEqual({
    reason: 'effect_not_undoable',
    why: 'not_undoable',
  });
  value(await undo(scene, holdEffect));
  expect(calendar()).toEqual([]);
  expect(value(await overview(scene)).holds).toEqual([]);
  const later = await remindedAndHeld(scene, '702');
  scene.world.adapters.clock.advance(32 * 3_600_000);
  expect(refusal(await undo(scene, later.holdEffect)).why).toBe('hold_ended');
}

describe('PA-7 My Assistant: the person sees and undoes their own assistant work', () => {
  it('shows the person their settings, delegation, budget, requests, effects and reminders', () =>
    withScene(showsThePersonTheirAssistant));
  it('shows an org admin the budget but none of the content, and refuses anyone else', () =>
    withScene(showsAnAdminNoContent));
  it('undoes a set reminder once, so it never fires, and only for the person', () =>
    withScene(undoesAReminderOnce));
  it('undoes a hold by removing it from the calendar, but not once it has ended', () =>
    withScene(undoesAHoldFromTheCalendar));
});

async function personDeletesTheirHistory(scene: AssistantScene): Promise<void> {
  await remindedAndHeld(scene);
  expect(refusal(await redact(scene, scene.rowan)).reason).toBe('no_assistant');
  const wiped = value(await redact(scene));
  expect(wiped.requests).toBe(1);
  const seen = value(await overview(scene));
  expect(seen.requests.map((request) => [request.note, request.redacted])).toEqual([['', true]]);
  expect(seen.reminders.map((reminder) => reminder.text)).toEqual(['Call Ana']);
  const log = await assistantLog(scene);
  expect(log.some((event) => event.name === 'assistant_request_recorded')).toBe(true);
  const redacted = log.filter((event) => event.name === 'assistant_history_redacted');
  expect(redacted.map((event) => event.evidence)).toEqual([{ why: 'person', requests: 1 }]);
  expect(JSON.stringify(log)).not.toContain('Remind me and hold Friday');
}

async function retentionRedactsAfterAYear(scene: AssistantScene): Promise<void> {
  await openTurn(scene, { externalId: '711', note: 'An old question' }).then((open) =>
    closeTurn(scene, open),
  );
  scene.world.adapters.clock.advance(200 * DAY_MS);
  value(await grantAssist(scene.world, scene.person, scene.harness.id));
  await readSpend(scene.world);
  await openTurn(scene, { externalId: '712', note: 'A newer question' }).then((open) =>
    closeTurn(scene, open),
  );
  scene.world.adapters.clock.advance(170 * DAY_MS);
  const { world } = scene;
  const swept = value(
    await world.kernel.assistants.redactHistory(simCaller(world, simSystem()), {}),
  );
  expect(swept.requests).toBe(1);
  const seen = value(await overview(scene));
  expect(seen.requests.map((request) => request.note)).toEqual(['A newer question', '']);
  const log = await assistantLog(scene);
  const redacted = log.filter((event) => event.name === 'assistant_history_redacted');
  expect(redacted.map((event) => event.evidence)).toEqual([{ why: 'retention', requests: 1 }]);
}

describe('PA-15 assistant history is kept one year, and the person may delete it sooner', () => {
  it('lets only the person delete their own history, keeping the content-free events', () =>
    withScene(personDeletesTheirHistory));
  it('redacts request text and replies older than 365 days in the nightly sweep', () =>
    withScene(retentionRedactsAfterAYear));
});

async function hidesThePersonalHarness(scene: AssistantScene): Promise<void> {
  const { world } = scene;
  const colleague = await simPerson(world, 8, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const listed = async (actor: typeof colleague) =>
    (await world.kernel.views.harnesses(simCaller(world, actor))).map((h) => h.id);
  expect(await listed(colleague)).not.toContain(scene.harness.id);
  expect(await listed(scene.rowan)).toContain(scene.harness.id);
  expect(await listed(scene.person)).toContain(scene.harness.id);
}

describe('PA-7 a personal harness is listed only to its person and org admins', () => {
  it('leaves it out of an area colleague list', () => withScene(hidesThePersonalHarness));
});
