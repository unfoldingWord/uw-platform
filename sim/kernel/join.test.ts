import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simIan } from '../fixtures.ts';
import { joinedHead, joinedPull, joinedRepository, joinRequest } from '../joining.ts';
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

async function createdEvents(world: World, harnessId: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === 'item_created');
}

describe('GL-3 joining by review request', () => {
  it('enqueues one item at Check with the head as its expected head and no harness branch', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, checkOnly, {
        repository: joinedRepository,
      });
      const first = value(await joinRequest(world));
      expect(first.created).toBe(true);
      expect(first.item).toMatchObject({
        stageKey: 'check',
        pullRequest: joinedPull,
        expectedHead: joinedHead,
        branchState: 'none',
        issue: null,
      });
      const again = value(await joinRequest(world, { head: 'b'.repeat(40) }));
      expect(again).toEqual({ item: first.item, created: false });
      expect(await createdEvents(world, harness.id)).toHaveLength(1);
    }));

  it('enqueues nothing on a repository with no harness, refusing no_harness_for_repo', () =>
    inWorld(async (world) => {
      expect(reasonOf(await joinRequest(world))).toBe('no_harness_for_repo');
    }));
});

describe('GL-3 who may join', () => {
  it('refuses a join from a person or without a platform Reviewer requested', () =>
    inWorld(async (world) => {
      await createSimHarness(world, checkOnly, { repository: joinedRepository });
      const other = await joinRequest(world, { requestedReviewers: ['seth-k'] });
      expect(reasonOf(other)).toBe('not_permitted');
      const person = simCaller(world, await simIan(world));
      const byPerson = await world.kernel.items.join(person, {
        pullRequest: joinedPull,
        head: joinedHead,
        title: 'x',
        requestedReviewers: ['uw-reviewer[bot]'],
      });
      expect(reasonOf(byPerson)).toBe('not_permitted');
    }));

  it('refuses a join on a harness with a Package stage', () =>
    inWorld(async (world) => {
      await createSimHarness(world, software, { key: 'other', repository: 'unfoldingWord/other' });
      const onSoftware = await joinRequest(world, {
        pullRequest: { repo: 'unfoldingWord/other', number: 3 },
      });
      expect(reasonOf(onSoftware)).toBe('transition_not_allowed');
    }));
});

describe('GL-6 joining needs the dispatch list', () => {
  it('refuses a join on a repository the area does not list', () =>
    inWorld(async (world) => {
      await createSimHarness(world, checkOnly, {
        repository: joinedRepository,
        dispatchable: false,
      });
      expect(reasonOf(await joinRequest(world))).toBe('dispatch_list_unavailable');
    }));
});
