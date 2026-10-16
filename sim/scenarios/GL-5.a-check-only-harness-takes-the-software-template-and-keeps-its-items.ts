import assert from 'node:assert/strict';
import { checkOnly, software } from '@uw/harness';
import { createSimHarness, simAdvance, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'GL-5',
  title:
    'an admin moves a check-only harness onto the software template; Check and Ship keep their ids and items, and the six new stages arrive empty in software order',
  run: async (world) => {
    const scene = await createSimHarness(world, checkOnly, {
      key: 'tc-admin-app',
      repository: 'unfoldingWord/tc-admin-app',
    });
    const caller = simCaller(world, scene.admin);
    const harnessId = scene.harness.id;
    const change = { exitGate: 'none' as const };
    value(await world.kernel.stages.updateStage(caller, { harnessId, stageKey: 'check', change }));
    const enqueue = async (title: string) =>
      value(
        await world.kernel.items.enqueue(caller, {
          harnessId,
          title,
          pageId: null,
          priority: 1,
          due: null,
          delegationId: null,
        }),
      ).itemId;
    const atCheck = await enqueue('Stay at Check');
    const atShip = await enqueue('Move to Ship');
    await simAdvance(world, { harnessId, itemId: atShip, worker: scene.admin, through: ['check'] });
    const before = scene.stages.map((stage) => [stage.key, stage.id]);
    const changed = value(
      await world.kernel.stages.changeTemplate(caller, { harnessId, template: 'software' }),
    );
    const items = await world.adapters.store.transaction((tx) =>
      tx.harnessItems.read.forHarness(harnessId),
    );
    const stageOf = new Map(items.map((item) => [item.itemId, item.stageKey]));
    const kept = changed.stages.filter((stage) => stage.key === 'check' || stage.key === 'ship');
    assert.equal(changed.harness.template, 'software');
    assert.deepEqual(
      changed.stages.map((stage) => [stage.key, stage.position]),
      software.stages.map((stage) => [stage.key, stage.position]),
    );
    assert.deepEqual(
      kept.map((stage) => [stage.key, stage.id]),
      before,
    );
    assert.deepEqual([stageOf.get(atCheck), stageOf.get(atShip)], ['check', 'ship']);
    return {
      state: {
        template: changed.harness.template,
        stages: changed.stages.map((stage) => stage.key),
      },
    };
  },
});
