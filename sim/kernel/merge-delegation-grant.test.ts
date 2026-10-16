import type { Principal, RiskTier } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly harnessId: string; readonly admin: Principal };

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    await work({ world, harnessId: harness.id, admin });
  } finally {
    await world.close();
  }
}

function grant(
  scene: Scene,
  actor: Principal,
  capability: 'merge' | 'build',
  maxTier: RiskTier | null,
) {
  return scene.world.kernel.delegations.grant(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    persona: 'agent:shipper',
    capability,
    maxTier,
    expiresAt: null,
    supersedes: null,
  });
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'accepted' ? null : outcome.reason;
}

async function grantEvents(scene: Scene) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.name === 'delegation_granted');
}

describe('MD-2 a merge delegation carries a tier, and only an admin grants one', () => {
  it('MD-2 an admin grants merge up to standard; the event names the grantor and the tier', () =>
    inScene(async (scene) => {
      const granted = await grant(scene, scene.admin, 'merge', 'standard');
      expect(granted).toMatchObject({
        status: 'accepted',
        value: { capability: 'merge', maxTier: 'standard' },
      });
      const [event] = await grantEvents(scene);
      expect(event?.evidence).toMatchObject({
        personId: scene.admin.personId,
        capability: 'merge',
        maxTier: 'standard',
      });
      expect(event?.actor).toBe(scene.admin.identity);
    }));

  it('MD-2 refuses high as tier_not_delegable and records nothing', () =>
    inScene(async (scene) => {
      expect(reasonOf(await grant(scene, scene.admin, 'merge', 'high'))).toBe('tier_not_delegable');
      expect(await grantEvents(scene)).toEqual([]);
    }));

  it('MD-2 refuses a merge grant with no tier, and a tier on any other capability', () =>
    inScene(async (scene) => {
      const none = await grant(scene, scene.admin, 'merge', null);
      expect(none).toMatchObject({
        status: 'error',
        reason: 'malformed_command',
        detail: { why: 'max_tier_required' },
      });
      const build = await grant(scene, scene.admin, 'build', 'low');
      expect(build).toMatchObject({
        status: 'error',
        reason: 'malformed_command',
        detail: { why: 'max_tier_only_for_merge' },
      });
      expect(reasonOf(await grant(scene, scene.admin, 'build', null))).toBeNull();
    }));

  it('MD-2 an editor on the area and an agent cannot grant merge', () =>
    inScene(async (scene) => {
      const editor = await simPerson(scene.world, 7, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      expect(reasonOf(await grant(scene, editor, 'merge', 'low'))).toBe('not_permitted');
      const agent = simAgent(scene.admin, 'shipper', { interactive: false });
      expect(reasonOf(await grant(scene, agent, 'merge', 'low'))).toBe('not_permitted');
      expect(await grantEvents(scene)).toEqual([]);
    }));
});
