import assert from 'node:assert/strict';
import {
  holdTime,
  inHours,
  inTimezone,
  readCalendar,
  releaseHold,
  seedEvent,
} from '../assistant-calendar-fixtures.ts';
import { assistantLog, grantedScene, type AssistantScene } from '../assistant-fixtures.ts';
import { closeTurn, openTurn } from '../assistant-reminder-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const holdTitle = 'Focus on Ruth 2';

function calendar(scene: AssistantScene) {
  return scene.world.adapters.workspace.events(personOf(scene.person));
}

async function todayInMyZone(scene: AssistantScene): Promise<number> {
  await inTimezone(scene, 'Europe/Berlin');
  seedEvent(scene, 'Team standup', '2026-10-01T07:30:00.000Z', 0.5);
  seedEvent(scene, 'Yesterday late', '2026-09-30T19:00:00.000Z', 1);
  const open = await openTurn(scene, { externalId: '1801', note: 'What is on my schedule today?' });
  const read = value(await readCalendar(scene, open));
  assert.equal(read.from, '2026-09-30T22:00:00.000Z');
  assert.deepEqual(
    read.events.map((event) => event.when),
    ['2026-10-01 09:30 to 10:00'],
  );
  await closeTurn(scene, open);
  return read.events.length;
}

async function holdOnce(scene: AssistantScene): Promise<string> {
  const open = await openTurn(scene, { externalId: '1802', note: 'Hold tomorrow morning' });
  const start = inHours(scene, 24);
  const drafted = value(
    await holdTime(scene, open, { title: holdTitle, start, end: inHours(scene, 26) }),
  );
  const again = value(
    await holdTime(scene, open, { title: holdTitle, start, end: inHours(scene, 26) }),
  );
  assert.equal(again.effectId, drafted.effectId);
  assert.equal(calendar(scene).filter((event) => event.hold !== null).length, 0);
  await closeTurn(scene, open);
  const holds = calendar(scene).filter((event) => event.hold !== null);
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0]?.attendees, []);
  assert.equal(holds[0]?.visibility, 'private');
  assert.equal(holds[0]?.notified, false);
  assert.equal(holds[0]?.hold?.harnessId, scene.harness.id);
  return drafted.effectId;
}

async function onlyMyOwnHold(scene: AssistantScene, holdId: string): Promise<void> {
  const open = await openTurn(scene, {
    externalId: '1803',
    note: 'Remove the standup and my hold',
  });
  const read = value(await readCalendar(scene, open, { day: '2026-10-01', days: 3 }));
  const standup = read.events.find((event) => event.holdId === null);
  assert.ok(standup);
  const notMine = await releaseHold(scene, open, '00000000-0000-4000-8000-00000000f0f0');
  assert.equal(notMine.status === 'error' && notMine.detail['why'], 'hold_not_found');
  value(await releaseHold(scene, open, holdId));
  await closeTurn(scene, open);
  assert.deepEqual(
    calendar(scene).map((event) => event.title),
    ['Team standup', 'Yesterday late'],
  );
}

async function contentFree(scene: AssistantScene): Promise<readonly string[]> {
  const events = await assistantLog(scene);
  for (const event of events) {
    assert.ok(
      !JSON.stringify(event.evidence).includes(holdTitle),
      `${event.name} carries the title`,
    );
  }
  return events.map((event) => event.name).filter((name) => name.startsWith('assistant_hold_'));
}

export const scenario = defineScenario({
  id: 'PA-8',
  title:
    "my assistant reads today's calendar in my timezone, and a hold it drafts lands once at the end of its turn on my own calendar as a private event with no attendees that tells nobody; it can remove only a hold it placed, and the log never carries the hold's title",
  run: async (world) => {
    const scene = await grantedScene(world);
    const today = await todayInMyZone(scene);
    const holdId = await holdOnce(scene);
    await onlyMyOwnHold(scene, holdId);
    const events = await contentFree(scene);
    return { state: { today, events } };
  },
});
