import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicFact, epicKey, epicOf, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simIngest, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const requestId = '00000000-0000-4000-8000-0000000000aa';

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function named(world: World, harnessId: string, name: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === name);
}

async function requestIds(world: World, harnessId: string, name: string) {
  const events = await named(world, harnessId, name);
  return events.map((event) => event.requestId);
}

async function evidenceNamed(world: World, harnessId: string, name: string) {
  const events = await named(world, harnessId, name);
  return events.map((event) => event.evidence);
}

function placesOf(
  items: readonly {
    issue: { number: number } | null;
    stageKey: string;
    epic: { position: number } | null;
  }[],
) {
  return items.map((item) => [item.issue?.number, item.stageKey, item.epic?.position]);
}

async function enqueuesFour(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(epicOfFour);
  const enqueued = value(await enqueueEpicAs(world, admin, harness.id));
  expect(enqueued.created).toBe(4);
  expect(placesOf(enqueued.items)).toEqual([
    [41, 'package', 0],
    [42, 'package', 1],
    [43, 'package', 2],
    [44, 'package', 3],
  ]);
  const [, , third, fourth] = enqueued.items;
  expect(fourth?.blockedBy).toEqual([third?.itemId]);
  expect(enqueued.items.map((item) => item.priority)).toEqual([0, -1000, -2000, -3000]);
  expect(enqueued.items.every((item) => item.epic?.issue.number === 40)).toBe(true);
  const items = await world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.forHarness(harness.id),
  );
  expect(items.some((item) => item.issue?.number === 40)).toBe(false);
}

async function recordsOnce(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(
    epicOf([
      epicFact(41, 'Read the sub-issues', { blockedBy: [7] }),
      epicFact(42, 'Require a done-when'),
    ]),
  );
  const caller = simCaller(world, admin, requestId);
  const first = value(
    await world.kernel.items.enqueueEpic(caller, { harnessId: harness.id, epic: epicKey }),
  );
  expect(await requestIds(world, harness.id, 'epic_enqueued')).toEqual([requestId]);
  expect((await evidenceNamed(world, harness.id, 'epic_enqueued'))[0]).toMatchObject({
    title: 'Epic intake',
    outside: [7],
    doneWhen: [
      'Read the sub-issues is merged and its tests pass.',
      'Require a done-when is merged and its tests pass.',
    ],
  });
  expect(await requestIds(world, harness.id, 'item_created')).toEqual([null, null]);
  const again = value(await enqueueEpicAs(world, admin, harness.id));
  expect(again).toEqual({ items: first.items, created: 0 });
  expect(await named(world, harness.id, 'epic_enqueued')).toHaveLength(1);
}

async function addsLater(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'Read the sub-issues')]));
  const [first] = value(await enqueueEpicAs(world, admin, harness.id)).items;
  world.adapters.githubFacts.givenEpic(
    epicOf([epicFact(41, 'Read the sub-issues'), epicFact(45, 'Follow up', { blockedBy: [41] })]),
  );
  const later = value(await enqueueEpicAs(world, admin, harness.id));
  expect(later.created).toBe(1);
  expect(later.items[0]).toEqual(first);
  expect(later.items[1]?.blockedBy).toEqual([first?.itemId]);
}

async function closedBlocksNothing(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(
    epicOf([
      epicFact(41, 'Done already', { open: false, doneWhen: [] }),
      epicFact(42, 'Next', { blockedBy: [41] }),
    ]),
  );
  const enqueued = value(await enqueueEpicAs(world, admin, harness.id));
  expect(enqueued.items.map((item) => [item.issue?.number, item.blockedBy])).toEqual([[42, []]]);
}

describe('EI-3 enqueue_epic makes one item per open sub-issue, in order, with blockers', () => {
  it('enqueues the four sub-issues in order at Package, the last blocked by the third, and no item for the epic', () =>
    inWorld(enqueuesFour));

  it('records epic_enqueued once with the outside blockers and the union of done-whens, and makes nothing twice', () =>
    inWorld(recordsOnce));

  it('adds a sub-issue that arrived later and points its blocker at the existing item', () =>
    inWorld(addsLater));

  it('gives a closed sub-issue no item and lets it block nothing', () =>
    inWorld(closedBlocksNothing));
});

async function notReadyEpic(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(
    epicOf([epicFact(41, 'Ready'), epicFact(42, 'Not ready', { doneWhen: [] })]),
  );
  expect(reasonOf(await enqueueEpicAs(world, admin, harness.id))).toBe('done_when_missing');
  expect(await evidenceNamed(world, harness.id, 'done_when_missing')).toEqual([
    {
      via: 'enqueue_epic',
      issue: epicFact(42, 'Not ready').issue,
      pageId: null,
      title: 'Not ready',
    },
  ]);
  expect(await named(world, harness.id, 'item_created')).toHaveLength(0);
}

describe('EI-2 an epic with a sub-issue lacking a done-when is not enqueued', () => {
  it('refuses done_when_missing, records it for that sub-issue only, and creates nothing', () =>
    inWorld(notReadyEpic));
});

async function refusesShapes(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  expect(reasonOf(await enqueueEpicAs(world, admin, harness.id))).toBe('issue_not_found');
  world.adapters.githubFacts.givenEpic(epicOf([]));
  const lone = await enqueueEpicAs(world, admin, harness.id);
  expect(lone.status === 'error' && [lone.reason, lone.detail['why']]).toEqual([
    'not_permitted',
    'not_an_epic',
  ]);
  world.adapters.githubFacts.givenEpic(epicOf([epicFact(41, 'Read')], 2));
  const stale = await enqueueEpicAs(world, admin, harness.id);
  expect(stale.status === 'error' && stale.detail['why']).toBe('sub_issues_not_read');
}

async function refusesCallers(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(
    epicOf([epicFact(41, 'A', { blockedBy: [42] }), epicFact(42, 'B', { blockedBy: [41] })]),
  );
  const cycle = await enqueueEpicAs(world, admin, harness.id);
  expect(cycle.status === 'error' && [cycle.reason, cycle.detail['why']]).toEqual([
    'malformed_command',
    'blocker_cycle',
  ]);
  world.adapters.githubFacts.givenEpic(epicOfFour);
  const viewer = await simPerson(world, 3, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const agent = simAgent(admin, `${admin.personId ?? ''}/builder`, { interactive: true });
  for (const actor of [viewer, agent, simIngest()]) {
    expect(reasonOf(await enqueueEpicAs(world, actor, harness.id))).toBe('not_permitted');
  }
  expect(await named(world, harness.id, 'item_created')).toHaveLength(0);
}

describe('EI-3 enqueue_epic refuses what it cannot enqueue', () => {
  it('refuses an unknown issue, an issue with no sub-issues and a list not yet read', () =>
    inWorld(refusesShapes));

  it('refuses a blocker cycle, an agent, the ingest principal and a viewer', () =>
    inWorld(refusesCallers));
});
