import assert from 'node:assert/strict';
import { holdTime, inHours } from '../assistant-calendar-fixtures.ts';
import { assistantLog, grantedScene, type AssistantScene } from '../assistant-fixtures.ts';
import {
  closeTurn,
  DAY_MS,
  dueIn,
  fireDue,
  MINUTE_MS,
  openTurn,
  setReminder,
} from '../assistant-reminder-fixtures.ts';
import { simCaller, simPerson } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const settings = {
  displayName: 'Barnabas',
  instructionsMd: 'Answer in two sentences.',
  timezone: 'Africa/Nairobi',
};

async function customisesOnlyMine(scene: AssistantScene): Promise<number> {
  const { world, person, harness, rowan } = scene;
  const seen = value(
    await world.kernel.views.myAssistant(simCaller(world, person), { personId: null }),
  );
  const input = { harnessId: harness.id, settings, expectedVersion: seen.settings?.version ?? 0 };
  const saved = value(await world.kernel.assistants.customise(simCaller(world, person), input));
  const admin = await world.kernel.assistants.customise(simCaller(world, rowan), {
    ...input,
    expectedVersion: saved.version,
  });
  assert.equal(admin.status === 'error' && admin.reason, 'not_permitted');
  const stale = await world.kernel.assistants.customise(simCaller(world, person), input);
  assert.equal(stale.status === 'error' && stale.reason, 'stale_version');
  return saved.version;
}

async function undoesItsWork(scene: AssistantScene): Promise<readonly string[]> {
  const { world, person } = scene;
  const open = await openTurn(scene, { externalId: '771', note: 'Remind me and hold time' });
  const reminder = value(await setReminder(scene, open, 'Call Ana', dueIn(scene, DAY_MS)));
  const hold = value(
    await holdTime(scene, open, {
      title: 'Focus',
      start: inHours(scene, 3),
      end: inHours(scene, 4),
    }),
  );
  await closeTurn(scene, open);
  const undo = (effectId: string) =>
    world.kernel.assistants.undoEffect(simCaller(world, person), { effectId });
  value(await undo(reminder.effectId));
  value(await undo(hold.effectId));
  assert.deepEqual(world.adapters.workspace.events(personOf(person)), []);
  world.adapters.clock.advance(DAY_MS + MINUTE_MS);
  assert.deepEqual(value(await fireDue(scene)).fired, []);
  const seen = value(
    await world.kernel.views.myAssistant(simCaller(world, person), { personId: null }),
  );
  return seen.requests[0]?.effects.map((effect) => `${effect.kind}:${effect.state}`) ?? [];
}

async function listedOnlyToMeAndAdmins(scene: AssistantScene): Promise<boolean> {
  const { world } = scene;
  const colleague = await simPerson(world, 9, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const shown = await world.kernel.views.harnesses(simCaller(world, colleague));
  const peek = await world.kernel.views.myAssistant(simCaller(world, colleague), {
    personId: personOf(scene.person),
  });
  assert.equal(peek.status === 'error' && peek.reason, 'not_permitted');
  return shown.some((harness) => harness.id === scene.harness.id);
}

export const scenario = defineScenario({
  id: 'PA-7',
  title:
    'a person customises their own assistant within its role at a version, sees its requests and effects, undoes a reminder and a hold in one step, and no one else can customise it, read its content or see it listed beside an area harness',
  run: async (world) => {
    const scene = await grantedScene(world);
    const version = await customisesOnlyMine(scene);
    const effects = await undoesItsWork(scene);
    assert.deepEqual(effects, [
      'reminder_set:undone',
      'calendar_hold_added:undone',
      'reply_to_requester:done',
    ]);
    const listed = await listedOnlyToMeAndAdmins(scene);
    assert.equal(listed, false);
    const log = await assistantLog(scene);
    assert.ok(!JSON.stringify(log).includes(settings.instructionsMd));
    return { state: { version, effects, listedToAnAreaAdmin: listed } };
  },
});
