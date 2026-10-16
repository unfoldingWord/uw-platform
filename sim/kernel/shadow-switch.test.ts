import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
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

function eventsOf(world: World, harnessId: string) {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
}

function nameOf(event: { readonly name: string }): string {
  return event.name;
}

const repository = 'unfoldingWord/tc-admin-app';

describe('GL-4 shadow is set at activation and lifted by an admin', () => {
  it('records shadow on template_activated and reads it back on the harness', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, checkOnly, { repository, shadow: true });
      expect(harness.shadow).toBe(true);
      const events = await eventsOf(world, harness.id);
      expect(events[0]?.evidence).toMatchObject({ template: 'check-only', shadow: true });
    }));

  it('lifts shadow once, records shadow_lifted, and refuses an area editor', () =>
    inWorld(async (world) => {
      const { harness, admin } = await createSimHarness(world, checkOnly, {
        repository,
        shadow: true,
      });
      const editor = await simPerson(world, 2, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      const refused = await world.kernel.stages.liftShadow(simCaller(world, editor), {
        harnessId: harness.id,
      });
      expect(refused).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const lifted = await world.kernel.stages.liftShadow(simCaller(world, admin), {
        harnessId: harness.id,
      });
      expect(lifted).toMatchObject({ status: 'accepted', value: { harness: { shadow: false } } });
      const again = await world.kernel.stages.liftShadow(simCaller(world, admin), {
        harnessId: harness.id,
      });
      expect(again.status).toBe('accepted');
      const names = (await eventsOf(world, harness.id)).map(nameOf);
      expect(names).toEqual(['template_activated', 'shadow_lifted']);
    }));
});

describe('PI-1 external reviewers are named at activation', () => {
  it('stores the logins and refuses one that names a platform Reviewer', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, checkOnly, {
        repository,
        externalReviewerIdentities: ['uwreview[bot]'],
      });
      expect(harness.externalReviewerIdentities).toEqual(['uwreview[bot]']);
      await expect(
        createSimHarness(world, checkOnly, {
          key: 'second',
          repository: 'unfoldingWord/second',
          externalReviewerIdentities: ['UW-Reviewer[bot]'],
        }),
      ).rejects.toThrow('malformed_command');
    }));
});
