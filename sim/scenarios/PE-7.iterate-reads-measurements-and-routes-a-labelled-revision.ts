import assert from 'node:assert/strict';
import { rewritePageBody } from '@uw/db/test-seed';
import type { Caller, KernelOutcome } from '@uw/harness';
import { readSpend, simAgent, simCaller, simDelegate } from '../fixtures.ts';
import {
  editorCaller,
  itemAtClose,
  itemEvents,
  iterateScene,
  seedIteratePage,
  valueOf,
  type IterateScene,
} from '../iterate.ts';
import { defineScenario } from '../scenario.ts';

const revision = '00000000-0000-4000-8000-000000009201';
const learning = '00000000-0000-4000-8000-000000009202';

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

async function delegate(scene: IterateScene): Promise<string> {
  const granted = await simDelegate(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    persona: 'agent:iterate',
    capability: 'iterate',
    expiresAt: null,
    supersedes: null,
  });
  return valueOf(granted).id;
}

async function measure(scene: IterateScene, itemId: string): Promise<void> {
  for (const [n, value] of [120, 135].entries()) {
    const asOf = `2026-01-0${String(n + 1)}`;
    const input = { itemId, source: 'web_analytics' as const, name: 'weekly readers', value, asOf };
    valueOf(await scene.world.kernel.measurements.record(editorCaller(scene), input));
  }
}

async function hostedIterate(scene: IterateScene, delegationId: string): Promise<Caller> {
  const persona = simCaller(scene.world, simAgent(scene.admin, 'iterate', { interactive: false }));
  const beat = valueOf(await scene.world.kernel.delegations.beat(persona, { delegationId }));
  return simCaller(scene.world, beat.principal);
}

async function draftPages(scene: IterateScene): Promise<void> {
  await seedIteratePage(scene.world, {
    id: revision,
    type: 'product_strategy',
    bodyMd: '- [observed] weekly readers rose from 120 to 135\n- shorter guides keep readers',
  });
  await seedIteratePage(scene.world, {
    id: learning,
    type: 'learning',
    bodyMd: '- [observed] weekly readers rose after the guide was shortened',
  });
}

function submit(scene: IterateScene, iterate: Caller, itemId: string) {
  return scene.world.kernel.items.submit(iterate, {
    itemId,
    to: 'scope',
    evidence: {},
    change: null,
    attach: [revision, learning],
  });
}

async function route(scene: IterateScene, iterate: Caller, itemId: string, delegationId: string) {
  valueOf(await scene.world.kernel.items.claim(iterate, { itemId, delegationId }));
  await draftPages(scene);
  const failed = valueOf(await submit(scene, iterate, itemId));
  assert.equal(failed.result, 'checks_failed');
  assert.match(failed.failures.join('\n'), new RegExp(`revision ${revision} has a claim`));
  const labelled =
    '- [observed] weekly readers rose from 120 to 135\n- [inferred] shorter guides keep readers';
  await rewritePageBody(scene.world.database.db, revision, labelled);
  return valueOf(await submit(scene, iterate, itemId));
}

export const scenario = defineScenario({
  id: 'PE-7',
  title:
    'Iterate reads the measurements a person recorded through the kernel read, claims only under its delegation, routes a labelled revision with a learning along the feeds edge to scope, and stops when the delegation is revoked',
  run: async (world) => {
    const scene = await iterateScene(world);
    await readSpend(world);
    const delegationId = await delegate(scene);
    const { itemId } = await itemAtClose(scene, 'Tune the lantern guide');
    await measure(scene, itemId);
    const iterate = await hostedIterate(scene, delegationId);
    const read = valueOf(await world.kernel.reads.measurements(iterate, { itemId }));
    assert.deepEqual(
      read.map((row) => row.value),
      [135, 120],
    );
    const unattended = await world.kernel.items.claim(iterate, { itemId, delegationId: null });
    assert.equal(reasonOf(unattended), 'delegation_required');
    const routed = await route(scene, iterate, itemId, delegationId);
    assert.deepEqual([routed.result, routed.item.stageKey], ['advanced', 'scope']);
    valueOf(await world.kernel.delegations.revoke(simCaller(world, scene.admin), { delegationId }));
    const stopped = await world.kernel.delegations.beat(iterate, { delegationId });
    assert.equal(reasonOf(stopped), 'delegation_lapsed');
    const events = await itemEvents(scene, itemId);
    const names = events.map((event) => event.name);
    assert.ok(names.includes('checks_passed'));
    assert.equal(names.filter((name) => name === 'learning_attached').length, 2);
    assert.equal(names.at(-1), 'loop_edge_taken');
    return { state: { item: routed.item, events: names } };
  },
});
