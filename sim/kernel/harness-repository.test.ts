import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { bml, readAllEvents, software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simIan } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World, ian: Caller) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world, simCaller(world, await simIan(world)));
  } finally {
    await world.close();
  }
}

function activateSoftware(world: World, ian: Caller, harnessKey: string, repository: string) {
  return world.kernel.stages.activate(ian, {
    harnessId: world.adapters.ids.next(),
    harnessKey,
    jdArea: '80-89',
    template: software,
    repository,
  });
}

function byRepository(world: World, repository: string) {
  return world.adapters.store.transaction((tx) => tx.harnesses.read.byRepository(repository));
}

async function storesAndRecords(world: World, ian: Caller): Promise<void> {
  const outcome = await activateSoftware(world, ian, 'software', 'unfoldingWord/uw-platform');
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  const { harness } = outcome.value;
  expect(harness.repository).toBe('unfoldingWord/uw-platform');
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harness.id, null),
  );
  expect(events.map((event) => [event.name, event.evidence])).toEqual([
    [
      'template_activated',
      expect.objectContaining({ template: 'software', repository: 'unfoldingWord/uw-platform' }),
    ],
  ]);
  expect(await byRepository(world, 'UnfoldingWord/UW-Platform')).toEqual(harness);
  expect(await byRepository(world, 'unfoldingWord/other')).toBeNull();
}

async function refusesTakenRepository(world: World, ian: Caller): Promise<void> {
  await activateSoftware(world, ian, 'software', 'unfoldingWord/uw-platform');
  const second = await activateSoftware(world, ian, 'second', 'UNFOLDINGWORD/uw-platform');
  expect(second).toEqual({
    status: 'error',
    reason: 'harness_exists',
    detail: { repository: 'UNFOLDINGWORD/uw-platform' },
  });
  expect(await byRepository(world, 'unfoldingWord/uw-platform')).toMatchObject({
    key: 'software',
  });
}

async function activatesWithoutRepository(world: World, ian: Caller): Promise<void> {
  const outcome = await world.kernel.stages.activate(ian, {
    harnessId: world.adapters.ids.next(),
    harnessKey: 'bml',
    jdArea: '30-39',
    template: bml,
    repository: null,
  });
  expect(outcome).toMatchObject({
    status: 'accepted',
    value: { harness: { key: 'bml', repository: null } },
  });
}

async function refusesMalformedRepository(world: World, ian: Caller): Promise<void> {
  const outcome = await activateSoftware(world, ian, 'software', 'no-slash');
  expect(outcome).toEqual({
    status: 'error',
    reason: 'malformed_command',
    detail: { repository: 'no-slash' },
  });
  expect(await world.adapters.store.transaction((tx) => tx.harnesses.read.list())).toEqual([]);
}

describe('GH-6 a harness names its repository', () => {
  it('stores the repository, records it on template_activated, and finds the harness by it in any case', () =>
    inWorld(storesAndRecords));
  it('refuses a second harness on a repository another harness holds, in any case', () =>
    inWorld(refusesTakenRepository));
  it('activates a harness that names no repository', () => inWorld(activatesWithoutRepository));
  it('refuses a repository that is not owner/name as malformed_command', () =>
    inWorld(refusesMalformedRepository));
});
