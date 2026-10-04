import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import {
  editorCaller,
  enqueuedItem,
  itemAtClose,
  itemEvents,
  iterateScene,
  valueOf,
  type IterateScene,
} from '../iterate.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

function measurement(itemId: string, change: Readonly<Record<string, unknown>> = {}) {
  return {
    itemId,
    source: 'web_analytics' as const,
    name: 'weekly readers',
    value: 120,
    asOf: '2026-01-01',
    ...change,
  };
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

async function inScene(work: (scene: IterateScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await iterateScene(world));
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: IterateScene) => Promise<void>): void {
  it(title, () => inScene(work));
}

async function measured(scene: IterateScene, itemId: string): Promise<number> {
  const events = await itemEvents(scene, itemId);
  return events.filter((event) => event.name === 'measurement_recorded').length;
}

async function recordsAtIterate(scene: IterateScene): Promise<void> {
  const { itemId } = await itemAtClose(scene, 'Tune the lantern guide');
  const { measurements } = scene.world.kernel;
  const first = valueOf(
    await measurements.record(editorCaller(scene), measurement(itemId, { name: ' readers ' })),
  );
  expect(first).toMatchObject({ itemId, name: 'readers', value: 120, asOf: '2026-01-01' });
  valueOf(
    await measurements.record(
      editorCaller(scene),
      measurement(itemId, { source: 'manual', asOf: '2026-01-05', value: 0.5 }),
    ),
  );
  const events = await itemEvents(scene, itemId);
  const recorded = events.filter((event) => event.name === 'measurement_recorded');
  expect(recorded.map((event) => event.evidence)).toEqual([
    {
      measurementId: first.id,
      source: 'web_analytics',
      name: 'readers',
      value: 120,
      asOf: '2026-01-01',
    },
    expect.objectContaining({ source: 'manual', value: 0.5, asOf: '2026-01-05' }),
  ]);
  expect(recorded[0]?.actor).toBe(scene.editor.identity);
}

async function refusesElsewhere(scene: IterateScene): Promise<void> {
  const { itemId } = await itemAtClose(scene, 'Tune the lantern guide');
  const atPackage = await enqueuedItem(scene, 'Not yet at iterate');
  const { measurements } = scene.world.kernel;
  const editor = editorCaller(scene);
  const elsewhere = await measurements.record(editor, measurement(atPackage));
  expect(elsewhere).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'not_at_iterate' },
  });
  const future = await measurements.record(editor, measurement(itemId, { asOf: '2999-01-01' }));
  expect(reasonOf(future)).toBe('malformed_command');
  const blank = await measurements.record(editor, measurement(itemId, { name: '   ' }));
  expect(reasonOf(blank)).toBe('malformed_command');
  const agent = simAgent(scene.editor, `${scene.editor.personId ?? ''}/laptop`, {
    interactive: true,
  });
  const byAgent = await measurements.record(simCaller(scene.world, agent), measurement(itemId));
  expect(reasonOf(byAgent)).toBe('not_permitted');
  const viewer = await simPerson(scene.world, 7, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const byViewer = await measurements.record(simCaller(scene.world, viewer), measurement(itemId));
  expect(reasonOf(byViewer)).toBe('not_permitted');
  expect(await measured(scene, itemId)).toBe(0);
  expect(await measured(scene, atPackage)).toBe(0);
}

async function readsThroughItemRule(scene: IterateScene): Promise<void> {
  const { itemId } = await itemAtClose(scene, 'Tune the lantern guide');
  const { measurements } = scene.world.kernel;
  valueOf(await measurements.record(editorCaller(scene), measurement(itemId)));
  valueOf(
    await measurements.record(editorCaller(scene), measurement(itemId, { asOf: '2026-02-01' })),
  );
  const read = valueOf(
    await scene.world.kernel.reads.measurements(editorCaller(scene), { itemId }),
  );
  expect(read.map((row) => row.asOf)).toEqual(['2026-02-01', '2026-01-01']);
  const stranger = await simPerson(scene.world, 8, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  const reads = scene.world.kernel.reads;
  const hidden = await reads.measurements(simCaller(scene.world, stranger), { itemId });
  const missingId = scene.world.adapters.ids.next();
  const missing = await reads.measurements(simCaller(scene.world, stranger), {
    itemId: missingId,
  });
  expect(hidden).toEqual({ status: 'error', reason: 'item_not_found', detail: { itemId } });
  expect(missing).toEqual({
    status: 'error',
    reason: 'item_not_found',
    detail: { itemId: missingId },
  });
  const unread = await measurements.record(simCaller(scene.world, stranger), measurement(itemId));
  expect(unread).toEqual({ status: 'error', reason: 'item_not_found', detail: { itemId } });
}

describe('measurements', () => {
  sceneIt(
    'PE-7 a person records a measurement on an item at the iterate bracket',
    recordsAtIterate,
  );
  sceneIt(
    'PE-7 a measurement elsewhere, in the future, or by an agent is refused',
    refusesElsewhere,
  );
  sceneIt(
    "PE-7 measurements are read through the item's read rule: hidden equals missing",
    readsThroughItemRule,
  );
});
