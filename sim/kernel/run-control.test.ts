import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant, seedGrant } from '@uw/db/test-seed';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import {
  beatOf,
  detailOf,
  itemEvents,
  itemInScope,
  itemOf,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  stepOn,
  value,
  watchingRuns,
  type RunsCalls,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';
import { readWorldLog } from '../runner/log.ts';

afterAll(closeEmbeddedTemplate);

type Started = RunWorld & { readonly runId: string; readonly calls: RunsCalls };

async function inStarted(work: (scene: Started) => Promise<void>): Promise<void> {
  const base = await createWorld();
  try {
    const { world, calls } = watchingRuns(base);
    const scene = await runWorld(world);
    const { runId } = value(await startOn(scene));
    await work({ ...scene, runId, calls });
    expect((await readWorldLog(base.adapters.store)).drift).toEqual([]);
  } finally {
    await base.close();
  }
}

function startedIt(title: string, work: (scene: Started) => Promise<void>): void {
  it(title, () => inStarted(work));
}

function editor(scene: RunWorld, n: number) {
  return simPerson(scene.world, n, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]);
}

async function countOf(scene: RunWorld): Promise<number> {
  return (await itemEvents(scene, scene.itemId)).length;
}

async function namesSince(scene: RunWorld, count: number): Promise<readonly string[]> {
  return (await itemEvents(scene, scene.itemId)).slice(count).map((event) => event.name);
}

function control(scene: Started, actor: Parameters<typeof simCaller>[1]) {
  const caller = simCaller(scene.world, actor);
  const runs = scene.world.kernel.runs;
  return {
    stop: () => runs.stop(caller, { itemId: scene.itemId }),
    prompt: (message: string) => runs.prompt(caller, { itemId: scene.itemId, message }),
  };
}

async function stopAborts(scene: Started): Promise<void> {
  const before = await countOf(scene);
  const stopped = value(await control(scene, scene.owner).stop());
  expect(stopped).toMatchObject({ id: scene.runId, outcome: 'stopped' });
  expect(stopped.endedAt).not.toBeNull();
  const events = (await itemEvents(scene, scene.itemId)).slice(before);
  expect(events.map((event) => event.name)).toEqual(['run_stopped', 'item_released']);
  expect(events[0]?.evidence).toEqual({ runId: scene.runId, why: 'stopped_by_person' });
  expect(events[1]?.evidence).toEqual({ holder: 'agent:builder' });
  expect(events.every((event) => event.actor === scene.owner.identity)).toBe(true);
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
  expect(scene.calls.stop).toEqual([scene.runId]);
  const again = await control(scene, scene.owner).stop();
  expect(reasonOf(again)).toBe('run_not_found');
  expect(detailOf(again)).toEqual({ itemId: scene.itemId });
}

async function adminOnly(scene: Started): Promise<void> {
  const other = control(scene, await editor(scene, 5));
  const before = await countOf(scene);
  for (const attempt of [await other.stop(), await other.prompt('look at the tests')]) {
    expect(reasonOf(attempt)).toBe('not_permitted');
    expect(detailOf(attempt)).toEqual({ harnessId: scene.harnessId });
  }
  expect(await countOf(scene)).toBe(before);
  expect(scene.calls.stop).toEqual([]);
  const admin = control(scene, scene.admin);
  value(await admin.prompt('look at the tests'));
  value(await admin.stop());
  expect(await namesSince(scene, before)).toEqual(['run_prompted', 'run_stopped', 'item_released']);
  expect(scene.calls.stop).toEqual([scene.runId]);
}

async function ownerWithWrite(scene: Started): Promise<void> {
  const at = scene.world.adapters.clock.now();
  const { db } = scene.world.database;
  for (const grant of scene.owner.grants) await revokeSeededGrant(db, grant.grantId, at);
  await seedGrant(db, {
    id: scene.world.adapters.ids.next(),
    personId: scene.owner.personId ?? '',
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: at,
    expiresAt: null,
  });
  const owner = control(scene, scene.owner);
  value(await owner.prompt('finish the docs first'));
  expect(value(await owner.stop()).outcome).toBe('stopped');
  expect(scene.calls.stop).toEqual([scene.runId]);
}

async function agentRefused(scene: Started): Promise<void> {
  const before = await countOf(scene);
  const asAgents = [
    scene.persona,
    (await beatOf(scene)).actor,
    simAgent(scene.admin, `${scene.admin.personId}/helper`, { interactive: true }),
  ];
  for (const actor of asAgents) {
    const agent = control(scene, actor);
    for (const attempt of [await agent.stop(), await agent.prompt('stop now')]) {
      expect(reasonOf(attempt)).toBe('not_permitted');
      expect(detailOf(attempt)).toEqual({ actor: actor.identity });
    }
  }
  expect(await countOf(scene)).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.outcome).toBe('running');
  expect(scene.calls.stop).toEqual([]);
}

async function promptDeliveredOnce(scene: Started): Promise<void> {
  const before = await countOf(scene);
  const message = 'Use the v2 endpoint for the export.';
  const prompted = value(await control(scene, scene.owner).prompt(message));
  expect(prompted.prompts).toEqual([message]);
  const events = (await itemEvents(scene, scene.itemId)).slice(before);
  expect(events.map((event) => event.name)).toEqual(['run_prompted']);
  expect(events[0]?.evidence).toEqual({ runId: scene.runId, message });
  const beat = await beatOf(scene);
  const first = value(await stepOn(scene, beat, { runId: scene.runId, step: 'read' }));
  expect(first.prompts).toEqual([message]);
  const second = value(await stepOn(scene, beat, { runId: scene.runId, step: 'work' }));
  expect(second.prompts).toEqual([]);
}

async function promptsFull(scene: Started): Promise<void> {
  const owner = control(scene, scene.owner);
  for (let n = 1; n <= 20; n += 1) value(await owner.prompt(`note ${n}`));
  const before = await countOf(scene);
  const full = await owner.prompt('note 21');
  expect(reasonOf(full)).toBe('not_permitted');
  expect(detailOf(full)).toEqual({ why: 'prompts_full' });
  expect(await countOf(scene)).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.prompts).toHaveLength(20);
}

async function malformedPrompt(scene: Started): Promise<void> {
  const owner = control(scene, scene.owner);
  const before = await countOf(scene);
  for (const message of ['', 'x'.repeat(4001)]) {
    const outcome = await owner.prompt(message);
    expect(reasonOf(outcome)).toBe('malformed_command');
  }
  expect(await countOf(scene)).toBe(before);
}

async function externalRunOwner(scene: Started): Promise<void> {
  value(await control(scene, scene.owner).stop());
  const max = await editor(scene, 6);
  const device = simCaller(
    scene.world,
    simAgent(max, `${max.personId}/builder`, { interactive: true }),
  );
  const itemId = await itemInScope(scene, 'Write the changelog');
  value(await scene.world.kernel.items.claim(device, { itemId, delegationId: null }));
  const runId = scene.world.adapters.ids.next();
  value(
    await scene.world.kernel.items.recordRunStep(device, {
      itemId,
      runId,
      step: 'read',
      tokensIn: 10,
      tokensOut: 2,
      costBasis: 'subscription',
    }),
  );
  const outsider = await scene.world.kernel.runs.stop(
    simCaller(scene.world, await editor(scene, 7)),
    { itemId },
  );
  expect(reasonOf(outsider)).toBe('not_permitted');
  const stopped = await scene.world.kernel.runs.stop(simCaller(scene.world, max), { itemId });
  expect(value(stopped)).toMatchObject({ id: runId, outcome: 'stopped', runShape: 'external-run' });
  expect((await itemOf(scene.world, itemId))?.holder).toBeNull();
  expect(scene.calls.stop).toEqual([scene.runId]);
}

async function hiddenIsMissing(scene: Started): Promise<void> {
  const stranger = await simPerson(scene.world, 8, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const outcome = await control(scene, stranger).stop();
  expect(reasonOf(outcome)).toBe('item_not_found');
  expect(detailOf(outcome)).toEqual({ itemId: scene.itemId });
}

describe('kernel.runs stop and prompt', () => {
  startedIt(
    'HE-1 stop aborts the run, releases the item and asks the Runs port to stop it',
    stopAborts,
  );

  startedIt(
    'HE-1 an editor who does not own the run is refused stop and prompt; an admin is not',
    adminOnly,
  );

  startedIt('HE-1 the delegating person stops their own run with write alone', ownerWithWrite);

  startedIt('HE-1 an agent is refused stop and prompt', agentRefused);

  startedIt("a prompt reaches the run's next step and is delivered once", promptDeliveredOnce);

  startedIt('a twenty-first pending prompt is refused prompts_full', promptsFull);

  startedIt('a blank or over-long prompt is malformed and records nothing', malformedPrompt);

  startedIt(
    "an external run's owner is the person in the runner's device identity, and its stop calls no Workflow",
    externalRunOwner,
  );

  startedIt('a person who cannot read the harness finds no item', hiddenIsMissing);
});
