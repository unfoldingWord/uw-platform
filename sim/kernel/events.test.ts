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
  repository: 'unfoldingWord/uw-platform',
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
  issue: null,
  zulipTopic: null,
});

const logged = [
  {
    name: 'item_created',
    itemId,
    evidence: { stage: 'build', title: 'Item', pageId: null, priority: 0, due: null },
  },
  {
    name: 'item_claimed',
    itemId,
    evidence: {
      holder: `human:${ianId}`,
      claimantKind: 'person',
      delegationId: null,
      leaseExpiresAt: null,
    },
  },
  { name: 'item_released', itemId, evidence: { holder: `human:${ianId}` } },
  { name: 'delegation_required', itemId: null, evidence: { stage: 'build' } },
] as const;

const loggedNames = logged.map((entry) => entry.name);

async function seedLog(world: World): Promise<void> {
  const { ids, clock, store } = world.adapters;
  await store.transaction(async (tx) => {
    await tx.harnesses.write.insert(harness, clock.now());
    await tx.harnessStages.write.insert(stage);
    await tx.harnessItems.write.insert(item, clock.now());
    await tx.harnessEvents.write.append(
      logged.map((entry) =>
        newEventSchema.parse({
          eventId: ids.next(),
          harnessId,
          itemId: entry.itemId,
          name: entry.name,
          at: clock.now().toISOString(),
          actor: `human:${ianId}`,
          evidence: entry.evidence,
          traceId,
          requestId: null,
        }),
      ),
    );
  });
}

type Query = { harnessId: string; itemId: string | null; after: number; limit: number };

async function readAs(world: World, actor: Principal, query: Query) {
  return world.kernel.events.read({ actor, traceId }, query);
}

function namesOf(outcome: Awaited<ReturnType<typeof readAs>>): string[] {
  return outcome.status === 'accepted' ? outcome.value.events.map((event) => event.name) : [];
}

async function ianOf(world: World): Promise<Principal> {
  const grants = await world.adapters.grants.resolve(ianId, world.adapters.clock.now());
  return principalFor(ianId, [...grants]);
}

async function withLog(check: (world: World, ian: Principal) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await seedLog(world);
    await check(world, await ianOf(world));
  } finally {
    await world.close();
  }
}

const everything: Query = { harnessId, itemId: null, after: 0, limit: 10 };

async function namesAcrossPages(world: World, ian: Principal, limit: number): Promise<string[]> {
  const names: string[] = [];
  let after = 0;
  let pages = 0;
  while (pages < 10) {
    const page = await readAs(world, ian, { ...everything, after, limit });
    if (page.status !== 'accepted') return names;
    names.push(...namesOf(page));
    pages += 1;
    if (page.value.next === null) return names;
    after = page.value.next;
  }
  return names;
}

describe('KN-4 the kernel reads a harness log through the one read path, checking can()', () => {
  it('gives an org admin the events in order', async () => {
    await withLog(async (world, ian) => {
      const read = await readAs(world, ian, everything);
      expect(namesOf(read)).toEqual(loggedNames);
    });
  });

  it('refuses a stranger not_permitted and an unknown harness harness_not_found', async () => {
    await withLog(async (world, ian) => {
      const stranger = principalFor(strangerId, []);
      expect(await readAs(world, stranger, everything)).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      const unknown = { ...everything, harnessId: '00000000-0000-4000-8000-0000000000ff' };
      expect(await readAs(world, ian, unknown)).toMatchObject({
        status: 'error',
        reason: 'harness_not_found',
      });
    });
  });

  it('follows next across pages of two without a gap or a repeat', async () => {
    await withLog(async (world, ian) => {
      expect(await namesAcrossPages(world, ian, 2)).toEqual(loggedNames);
    });
  });

  it('narrows to one item when asked', async () => {
    await withLog(async (world, ian) => {
      const read = await readAs(world, ian, { ...everything, itemId });
      expect(namesOf(read)).toEqual(['item_created', 'item_claimed', 'item_released']);
    });
  });
});
