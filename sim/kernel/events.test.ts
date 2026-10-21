import {
  harnessSchema,
  identitySchema,
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
  epic: null,
  blockedBy: [],
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
const missingHarnessId = '00000000-0000-4000-8000-0000000000ff';
const missingReply = {
  status: 'error',
  reason: 'harness_not_found',
  detail: { harnessId: missingHarnessId },
};

function agentOf(ian: Principal, identity: string, interactive: boolean): Principal {
  return principalSchema.parse({ ...ian, identity, kind: 'agent', email: null, interactive });
}

async function hiddenLikeMissing(world: World, actor: Principal): Promise<void> {
  const hidden = await readAs(world, actor, everything);
  const missing = await readAs(world, actor, { ...everything, harnessId: missingHarnessId });
  expect(missing).toEqual(missingReply);
  expect(JSON.stringify(hidden)).toBe(JSON.stringify(missing).replace(missingHarnessId, harnessId));
}

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

  it('refuses an unknown harness harness_not_found', async () => {
    await withLog(async (world, ian) => {
      const unknown = { ...everything, harnessId: missingHarnessId };
      expect(await readAs(world, ian, unknown)).toEqual(missingReply);
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

describe('WB-3 an event read on a harness the caller may not read answers harness_not_found, like a missing one', () => {
  it('answers a person without a grant as it answers a missing harness', async () => {
    await withLog(async (world) => {
      await hiddenLikeMissing(world, principalFor(strangerId, []));
    });
  });

  it('answers an unattended agent with no delegation as it answers a missing harness', async () => {
    await withLog(async (world, ian) => {
      await hiddenLikeMissing(world, agentOf(ian, `agent:${ianId}/runner`, false));
    });
  });

  it('answers a bare persona with no live delegation as it answers a missing harness', async () => {
    await withLog(async (world, ian) => {
      await hiddenLikeMissing(world, agentOf(ian, 'agent:builder', true));
    });
  });

  it('answers a delegated identity whose delegation is not live as it answers a missing harness', async () => {
    await withLog(async (world, ian) => {
      const identity = `agent:${ianId}/laptop as builder via delegation:${missingHarnessId}`;
      await hiddenLikeMissing(world, agentOf(ian, identity, false));
    });
  });

  it('answers a device naming another person as it answers a missing harness', async () => {
    await withLog(async (world, ian) => {
      const foreign: Principal = {
        ...ian,
        identity: identitySchema.parse(`agent:${strangerId}/laptop`),
        kind: 'agent',
        email: null,
      };
      await hiddenLikeMissing(world, foreign);
    });
  });

  it("gives the owner's interactive device the same events the owner reads", async () => {
    await withLog(async (world, ian) => {
      const device = agentOf(ian, `agent:${ianId}/laptop`, true);
      expect(namesOf(await readAs(world, device, everything))).toEqual(loggedNames);
    });
  });
});

describe('the kernel refuses a malformed event query before reading', () => {
  const malformed: readonly (readonly [string, Partial<Query>])[] = [
    ['a negative cursor', { after: -1 }],
    ['a fractional cursor', { after: 1.5 }],
    ['an empty page', { limit: 0 }],
    ['a page over the limit', { limit: 101 }],
    ['an item that is not an id', { itemId: 'not-an-id' }],
  ];
  it.each(malformed)('answers %s malformed_command', async (_name, change) => {
    await withLog(async (world, ian) => {
      expect(await readAs(world, ian, { ...everything, ...change })).toMatchObject({
        status: 'error',
        reason: 'malformed_command',
      });
    });
  });

  it('answers a harness that is not an id as it answers a missing harness', async () => {
    await withLog(async (world, ian) => {
      expect(await readAs(world, ian, { ...everything, harnessId: 'not-an-id' })).toEqual({
        status: 'error',
        reason: 'harness_not_found',
        detail: { harnessId: 'not-an-id' },
      });
    });
  });
});
