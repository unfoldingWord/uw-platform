import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAdvance, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function joined(world: World) {
  const scene = await createSimHarness(world, checkOnly, {
    key: 'tc-admin-app',
    repository: 'unfoldingWord/tc-admin-app',
  });
  const caller = simCaller(world, scene.admin);
  const harnessId = scene.harness.id;
  const exitNone = { exitGate: 'none' as const };
  value(
    await world.kernel.stages.updateStage(caller, {
      harnessId,
      stageKey: 'check',
      change: exitNone,
    }),
  );
  const enqueue = (title: string) =>
    world.kernel.items.enqueue(caller, {
      harnessId,
      title,
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    });
  const atCheck = value(await enqueue('Stay at Check')).itemId;
  const atShip = value(await enqueue('Move to Ship')).itemId;
  await simAdvance(world, { harnessId, itemId: atShip, worker: scene.admin, through: ['check'] });
  return { ...scene, caller, atCheck, atShip };
}

async function keepsCheckAndShip(world: World): Promise<void> {
  const scene = await joined(world);
  const harnessId = scene.harness.id;
  const before = scene.stages.map((stage) => [stage.key, stage.id]);
  const changed = value(
    await world.kernel.stages.changeTemplate(scene.caller, { harnessId, template: 'software' }),
  );
  expect(changed.harness.template).toBe('software');
  expect(changed.stages.map((stage) => stage.key)).toEqual(software.stages.map((s) => s.key));
  expect(changed.stages.map((stage) => stage.position)).toEqual(
    software.stages.map((s) => s.position),
  );
  const kept = changed.stages.filter((stage) => stage.key === 'check' || stage.key === 'ship');
  expect(kept.map((stage) => [stage.key, stage.id])).toEqual(before);
  expect(kept.find((stage) => stage.key === 'check')?.exitGate).toBe('none');
  const stored = await world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(harnessId),
  );
  expect(stored.map((stage) => [stage.key, stage.position])).toEqual(
    changed.stages.map((stage) => [stage.key, stage.position]),
  );
  const items = await world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.forHarness(harnessId),
  );
  const stageOf = new Map(items.map((item) => [item.itemId, item.stageKey]));
  expect([stageOf.get(scene.atCheck), stageOf.get(scene.atShip)]).toEqual(['check', 'ship']);
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  expect(events.filter((event) => event.name === 'template_changed')).toHaveLength(1);
}

const triage = {
  key: 'triage',
  title: 'Triage',
  position: 5,
  bracket: 'build_package' as const,
  agentPickup: 'allowed' as const,
  exitGate: 'checks' as const,
  connector: 'none' as const,
  wipLimit: 3,
  instructionsPageId: null,
  validators: [],
  feeds: [],
};

async function refusesOthers(world: World): Promise<void> {
  const scene = await joined(world);
  const harnessId = scene.harness.id;
  const change = (template: string) =>
    world.kernel.stages.changeTemplate(scene.caller, { harnessId, template });
  expect(reasonOf(await change('bml'))).toBe('template_change_not_allowed');
  value(await change('software'));
  expect(reasonOf(await change('software'))).toBe('template_change_not_allowed');
  const other = await createSimHarness(world, checkOnly, {
    key: 'edited',
    repository: 'unfoldingWord/edited',
  });
  const otherCaller = simCaller(world, other.admin);
  const otherId = other.harness.id;
  value(await world.kernel.stages.createStage(otherCaller, { harnessId: otherId, stage: triage }));
  const refused = await world.kernel.stages.changeTemplate(otherCaller, {
    harnessId: otherId,
    template: 'software',
  });
  expect(refused).toMatchObject({
    status: 'error',
    reason: 'template_change_not_allowed',
    detail: { why: 'stages_edited' },
  });
}

async function refusesEditor(world: World): Promise<void> {
  const scene = await joined(world);
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const refused = await world.kernel.stages.changeTemplate(simCaller(world, editor), {
    harnessId: scene.harness.id,
    template: 'software',
  });
  expect(reasonOf(refused)).toBe('not_permitted');
}

describe('GL-5 a template change on a live harness', () => {
  it('GL-5 moves a check-only harness to software, keeping Check and Ship and their items, the new stages empty', () =>
    inWorld(keepsCheckAndShip));

  it('GL-5 refuses any other change, a second change, and a harness whose stages were added to', () =>
    inWorld(refusesOthers));

  it('GL-5 refuses a person who is not an admin on the area', () => inWorld(refusesEditor));
});
