import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicFact, epicOf } from '../epics.ts';
import { createSimHarness, simCaller, simIngest } from '../fixtures.ts';
import { value } from '../runs.ts';
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

async function evidenceNamed(world: World, harnessId: string, name: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === name).map((event) => event.evidence);
}

async function importAs(world: World, harnessId: string, issue: { repo: string; number: number }) {
  const outcome = await world.kernel.items.importIssue(simCaller(world, simIngest()), {
    harnessId,
    issue: { ...issue, githubId: 9100000300 + issue.number },
    title: `Issue ${issue.number}`,
    pageId: null,
    doneWhen: [`Issue ${issue.number} ships.`],
  });
  return value(outcome).item;
}

async function existingNotChecked(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'First'), epicFact(42, 'Second')]));
  value(await enqueueEpicAs(world, admin, harness.id));
  world.adapters.githubFacts.givenEpic(
    epicOf([
      epicFact(41, 'First', { doneWhen: [] }),
      epicFact(42, 'Second'),
      epicFact(45, 'Later'),
    ]),
  );
  const later = value(await enqueueEpicAs(world, admin, harness.id));
  expect(later.created).toBe(1);
  expect(await evidenceNamed(world, harness.id, 'done_when_missing')).toEqual([]);
}

async function heldOutsideBlocks(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const held = await importAs(world, harness.id, { repo: 'unfoldingWord/uw-platform', number: 7 });
  world.adapters.githubFacts.givenEpic(
    epicOf([
      epicFact(41, 'Waits on held', { blockedBy: [7] }),
      epicFact(42, 'Waits on none', { blockedBy: [8] }),
    ]),
  );
  const enqueued = value(await enqueueEpicAs(world, admin, harness.id));
  expect(enqueued.items.map((item) => item.blockedBy)).toEqual([[held.itemId], []]);
  const [recorded] = await evidenceNamed(world, harness.id, 'epic_enqueued');
  expect(recorded).toMatchObject({ outside: [8] });
}

async function otherHarnessRefused(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const other = await createSimHarness(world, software, { key: 'uw-other' });
  await importAs(world, other.harness.id, { repo: 'unfoldingWord/uw-other', number: 41 });
  world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'Elsewhere'), epicFact(42, 'Here')]));
  const refused = await enqueueEpicAs(world, admin, harness.id);
  expect(refused.status === 'error' && [refused.reason, refused.detail['why']]).toEqual([
    'not_permitted',
    'repository_mismatch',
  ]);
  expect(await evidenceNamed(world, harness.id, 'item_created')).toEqual([]);
}

describe('EI-2 enqueue_epic checks the done-when only of sub-issues that have no item yet', () => {
  it('re-enqueues after a sub-issue with an item lost its done-when, creating only the new one', () =>
    inWorld(existingNotChecked));
});

describe('EI-3 enqueue_epic follows a blocker outside the epic only to an item it already has', () => {
  it('draws an edge to an item in this harness and lists a blocker with no item as outside', () =>
    inWorld(heldOutsideBlocks));

  it('refuses repository_mismatch for a sub-issue whose item is in another harness', () =>
    inWorld(otherHarnessRefused));
});
