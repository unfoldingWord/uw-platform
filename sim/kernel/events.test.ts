import {
  harnessSchema,
  itemStateSchema,
  newEventSchema,
  principalSchema,
  stageSchema,
  type Principal,
} from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const ianId = '00000000-0000-4000-8000-000000000001';
const strangerId = '00000000-0000-4000-8000-000000000002';
const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const traceId = '00000000-0000-4000-8000-0000000000e1';

function principalFor(personId: string, grants: Principal['grants']): Principal {
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: `${personId}@unfoldingword.org`,
    grants,
    interactive: true,
  });
}

const harness = harnessSchema.parse({
  id: harnessId,
  key: 'software',
  template: 'software',
  jdArea: '80-89',
  hostedBuilderEnabled: false,
  paused: false,
});
const stage = stageSchema.parse({
  id: '00000000-0000-4000-8000-0000000000c1',
  harnessId,
  key: 'build',
  title: 'Build',
  position: 10,
  bracket: 'build_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'none',
  wipLimit: 3,
  instructionsPageId: null,
  validators: [],
  feeds: [],
  paused: false,
});
const item = itemStateSchema.parse({
  itemId,
  harnessId,
  stageKey: 'build',
  title: 'Item',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'none',
  expectedHead: null,
  riskTier: null,
  riskDomains: [],
  pullRequest: null,
  zulipTopic: null,
});

async function seedLog(world: World): Promise<void> {
  const { ids, clock, store } = world.adapters;
  const names = ['item_created', 'item_claimed', 'item_released'] as const;
  const evidence = [
    { stage: 'build', title: 'Item', pageId: null, priority: 0, due: null },
    { holder: `human:${ianId}`, claimantKind: 'person', delegationId: null, leaseExpiresAt: null },
    { holder: `human:${ianId}` },
  ];
  await store.transaction(async (tx) => {
    await tx.harnesses.write.insert(harness, clock.now());
    await tx.harnessStages.write.insert(stage);
    await tx.harnessItems.write.insert(item, clock.now());
    await tx.harnessEvents.write.append(
      names.map((name, index) =>
        newEventSchema.parse({
          eventId: ids.next(),
          harnessId,
          itemId,
          name,
          at: clock.now().toISOString(),
          actor: `human:${ianId}`,
          evidence: evidence[index],
          traceId,
        }),
      ),
    );
  });
}

async function readAs(world: World, actor: Principal, id: string) {
  return world.kernel.events.read(
    { actor, traceId },
    { harnessId: id, itemId: null, after: 0, limit: 10 },
  );
}

describe('KN-4 the kernel reads a harness log through the one read path, checking can()', () => {
  it('gives an org admin the events in order, a stranger not_permitted, and an unknown harness harness_not_found', async () => {
    const world = await createWorld();
    try {
      await seedLog(world);
      const grants = await world.adapters.grants.resolve(ianId, world.adapters.clock.now());
      const ian = principalFor(ianId, [...grants]);
      const read = await readAs(world, ian, harnessId);
      expect(read.status).toBe('accepted');
      expect(
        read.status === 'accepted' ? read.value.events.map((event) => event.name) : [],
      ).toEqual(['item_created', 'item_claimed', 'item_released']);
      const stranger = principalFor(strangerId, []);
      expect(await readAs(world, stranger, harnessId)).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      expect(await readAs(world, ian, '00000000-0000-4000-8000-0000000000ff')).toMatchObject({
        status: 'error',
        reason: 'harness_not_found',
      });
    } finally {
      await world.close();
    }
  });
});
