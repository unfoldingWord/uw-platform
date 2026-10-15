import assert from 'node:assert/strict';
import type { HarnessEvent, IssueRef } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller, simIngest, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const pageId = '00000000-0000-4000-8000-000000003001';
const issue: IssueRef = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };
const firstUpdate = '2026-10-02T09:00:00.000Z';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function logOf(world: World, harnessId: string): Promise<readonly HarnessEvent[]> {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
}

function named(events: readonly HarnessEvent[], name: string): readonly HarnessEvent[] {
  return events.filter((event) => event.name === name);
}

async function seedIssuePage(world: World): Promise<void> {
  await seedPage(world.database.db, {
    id: pageId,
    type: 'issue',
    status: 'active',
    jdArea: '80-89',
    bodyMd: 'Wire the board',
    slug: 'issue-12',
    title: 'Wire the board',
  });
}

function importAs(world: World, caller: Caller, harnessId: string) {
  return world.kernel.items.importIssue(caller, {
    harnessId,
    issue,
    title: 'Wire the board',
    pageId,
  });
}

function removeLabel(world: World) {
  return world.kernel.items.labelRemoved(simCaller(world, simIngest()), {
    githubId: issue.githubId,
    label: 'harness',
    githubUpdatedAt: firstUpdate,
  });
}

async function importsOnce(world: World, harnessId: string, editor: Caller) {
  const first = valueOf(await importAs(world, simCaller(world, simIngest()), harnessId));
  assert.equal(first.created, true);
  assert.equal(first.item.stageKey, 'package');
  assert.deepEqual(first.item.issue, issue);
  const before = await logOf(world, harnessId);
  const created = named(before, 'item_created');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.evidence, {
    stage: 'package',
    title: 'Wire the board',
    pageId,
    priority: 0,
    due: null,
    issue,
    pullRequest: null,
    expectedHead: null,
  });
  const again = valueOf(await importAs(world, simCaller(world, simIngest()), harnessId));
  assert.deepEqual(again, { item: first.item, created: false });
  const byEditor = valueOf(await importAs(world, editor, harnessId));
  assert.deepEqual(byEditor, { item: first.item, created: false });
  assert.equal((await logOf(world, harnessId)).length, before.length);
  return first.item;
}

async function recordsRemovalOnce(world: World, harnessId: string, itemId: string) {
  const removed = valueOf(await removeLabel(world));
  assert.equal(removed.recorded, true);
  assert.equal(removed.item.itemId, itemId);
  assert.equal(removed.item.stageKey, 'package');
  assert.equal(removed.item.gateStatus, 'working');
  const repeated = valueOf(await removeLabel(world));
  assert.equal(repeated.recorded, false);
  assert.equal(repeated.item.stageKey, 'package');
  const labels = named(await logOf(world, harnessId), 'label_removed');
  assert.deepEqual(
    labels.map((event) => event.evidence),
    [{ issue, label: 'harness', githubUpdatedAt: firstUpdate }],
  );
  return labels.length;
}

async function manualShape(world: World, harnessId: string, editor: Caller) {
  const manual = valueOf(
    await world.kernel.items.enqueue(editor, {
      harnessId,
      title: 'Write the guide',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  const created = named(await logOf(world, harnessId), 'item_created');
  const evidence = created.find((event) => event.itemId === manual.itemId)?.evidence;
  assert.deepEqual(evidence, {
    stage: 'package',
    title: 'Write the guide',
    pageId: null,
    priority: 1,
    due: null,
    issue: null,
    pullRequest: null,
    expectedHead: null,
  });
  assert.deepEqual(Object.keys(evidence).sort(), Object.keys(created[0]?.evidence ?? {}).sort());
}

export const scenario = defineScenario({
  id: 'GH-3',
  title:
    'an issue carrying the label becomes one item in Package of its harness, importing again makes none, removing the label records one event and keeps the item, and manual enqueue records the same item_created shape',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    await seedIssuePage(world);
    const editor = simCaller(
      world,
      await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]),
    );
    const item = await importsOnce(world, harness.id, editor);
    const labelEvents = await recordsRemovalOnce(world, harness.id, item.itemId);
    await manualShape(world, harness.id, editor);
    const items = await world.adapters.store.transaction((tx) =>
      tx.harnessItems.read.forHarness(harness.id),
    );
    assert.equal(items.length, 2);
    return { state: { items: items.length, labelEvents } };
  },
});
