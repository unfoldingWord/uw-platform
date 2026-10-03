import { describe, expect, it } from 'vitest';
import { identitySchema, type ItemState } from '@uw/contracts';
import type { GateDecisionRow, PageFacts, Store, StoreTransaction } from '../ports.ts';
import { awaitBlocked, type LockWaiters } from './lock-wait.ts';
import { describeDelegations } from './store-delegations.ts';
import { describeEvents } from './store-events.ts';
import { describeHarnessRepositories } from './store-harnesses.ts';
import { describeItemIssues } from './store-items-issue.ts';
import {
  at,
  harnessOf,
  hour,
  itemOf,
  refusedBy,
  seedHarness,
  stageOf,
  uid,
} from './store-gateway-fixtures.ts';

export type SeededPage = Omit<PageFacts, 'version'> & { readonly slug: string };

export type GatewaySubject = {
  readonly store: Store;
  readonly lockWaiters?: LockWaiters;
  seedPage(page: SeededPage): Promise<void>;
};

function describeHarnesses(subject: () => GatewaySubject): void {
  it('DX-3 inserts and reads a harness by id, by key and in the list', async () => {
    const harness = harnessOf(0x100, 'gateway-read-b');
    const other = harnessOf(0x200, 'gateway-read-a');
    const found = await subject().store.transaction(async (tx) => {
      await tx.harnesses.write.insert(harness, at);
      await tx.harnesses.write.insert(other, at);
      const listed = await tx.harnesses.read.list();
      return {
        byId: await tx.harnesses.read.byId(harness.id),
        byKey: await tx.harnesses.read.byKey('gateway-read-b'),
        missing: await tx.harnesses.read.byKey('gateway-read-none'),
        keys: listed.map((entry) => entry.key).filter((key) => key.startsWith('gateway-read-')),
      };
    });
    expect(found).toEqual({
      byId: harness,
      byKey: harness,
      missing: null,
      keys: ['gateway-read-a', 'gateway-read-b'],
    });
  });

  it('DX-3 refuses a second harness with the same key as a StoreRefusedError 23505', async () => {
    const outcome = await refusedBy(async (tx) => {
      await tx.harnesses.write.insert(harnessOf(0x300, 'gateway-dup'), at);
      await tx.harnesses.write.insert(harnessOf(0x400, 'gateway-dup'), at);
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23505', table: 'harnesses' });
  });
}

function describeStages(subject: () => GatewaySubject): void {
  it('DX-3 KN-2 refuses a stage update to (merge, checks), naming the constraint', async () => {
    const outcome = await refusedBy(async (tx) => {
      const { ship } = await seedHarness(tx, 0x500, 'gateway-ship');
      await tx.harnessStages.write.update({ ...ship, exitGate: 'checks' });
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23514',
      constraint: 'harness_stages_effect_needs_human_gate',
    });
  });

  it('DX-3 returns stages in position order and repositions without a unique clash', async () => {
    const result = await subject().store.transaction(async (tx) => {
      const { build, review, ship } = await seedHarness(tx, 0x600, 'gateway-order');
      await tx.harnessStages.write.reposition(uid(0x600), [
        { id: ship.id, position: 1 },
        { id: build.id, position: 2 },
        { id: review.id, position: 3 },
      ]);
      return (await tx.harnessStages.read.forHarness(uid(0x600))).map((stage) => [
        stage.key,
        stage.position,
      ]);
    });
    expect(result).toEqual([
      ['ship', 1],
      ['build', 2],
      ['review', 3],
    ]);
  });
}

const everyField = {
  stageKey: 'ship',
  priority: 4,
  due: '2026-10-15',
  holder: 'agent:builder',
  claimantKind: 'agent',
  leaseExpiresAt: new Date(at.getTime() + hour).toISOString(),
  gateStatus: 'parked',
  gateTarget: 'build',
  branchState: 'active',
  expectedHead: 'a'.repeat(40),
  riskTier: 'high',
  riskDomains: ['acl', 'infra'],
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
  issue: { repo: 'unfoldingWord/uw-platform', number: 8, githubId: 9100000101 },
  zulipTopic: 'harness 7',
} as const;

function instructionsPage(id: string): SeededPage {
  return {
    id,
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    bodyMd: 'body',
    frontmatter: {},
    slug: `gateway-instructions-${id.slice(-3)}`,
    title: 'Gateway instructions',
  };
}

function describeInstructions(subject: () => GatewaySubject): void {
  it('DX-3 says whether any stage names a page as its instructions', async () => {
    const named = uid(0x18f1);
    const unnamed = uid(0x18f2);
    await subject().seedPage(instructionsPage(named));
    await subject().seedPage(instructionsPage(unnamed));
    const found = await subject().store.transaction(async (tx) => {
      const { review } = await seedHarness(tx, 0x1800, 'gateway-instructions');
      await tx.harnessStages.write.update({ ...review, instructionsPageId: named });
      return {
        named: await tx.harnessStages.read.namesInstructions(named),
        unnamed: await tx.harnessStages.read.namesInstructions(unnamed),
      };
    });
    expect(found).toEqual({ named: true, unnamed: false });
  });
}

function describeMissingStage(subject: () => GatewaySubject): void {
  it('DX-3 refuses to update a stage that does not exist', async () => {
    const missing = stageOf(0x1100, 1, 'build', 1);
    const outcome = await subject()
      .store.transaction(async (tx) => {
        await tx.harnessStages.write.update(missing);
      })
      .then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : 'rejected'),
      );
    expect(outcome).toBe(`no stage ${missing.id} to update`);
  });
}

function describeProjection(subject: () => GatewaySubject): void {
  it('DX-3 projects every item field and reads it back unchanged', async () => {
    const pageId = uid(0x7ff);
    await subject().seedPage({
      id: pageId,
      type: 'product',
      status: 'active',
      jdArea: '80-89',
      bodyMd: 'body',
      frontmatter: {},
      slug: 'gateway-project',
      title: 'Gateway project',
    });
    const full = itemOf(0x700, 1, { ...everyField, pageId });
    const read = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x700, 'gateway-project');
      await tx.harnessItems.write.insert(itemOf(0x700, 1), at);
      await tx.harnessItems.write.project(full);
      return {
        byId: await tx.harnessItems.read.byId(full.itemId),
        locked: await tx.harnessItems.read.lock(full.itemId),
        listed: await tx.harnessItems.read.forHarness(uid(0x700)),
        absent: await tx.harnessItems.read.byId(uid(0x7fe)),
        lockedAbsent: await tx.harnessItems.read.lock(uid(0x7fe)),
      };
    });
    expect(read).toEqual({
      byId: full,
      locked: full,
      listed: [full],
      absent: null,
      lockedAbsent: null,
    });
  });

  it('DX-3 refuses to project an item that does not exist', async () => {
    const outcome = await subject()
      .store.transaction(async (tx) => {
        await seedHarness(tx, 0x800, 'gateway-absent');
        await tx.harnessItems.write.project(itemOf(0x800, 1));
      })
      .then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : 'rejected'),
      );
    expect(outcome).toBe(`no item ${uid(0x80b)} to project`);
  });
}

function describeItemOrder(subject: () => GatewaySubject): void {
  it('DX-3 lists items by priority, then creation, then id', async () => {
    const later = new Date(at.getTime() + hour);
    const order = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x900, 'gateway-items');
      await tx.harnessItems.write.insert(itemOf(0x900, 4, { priority: 2 }), at);
      await tx.harnessItems.write.insert(itemOf(0x900, 2, { priority: 1 }), later);
      await tx.harnessItems.write.insert(itemOf(0x900, 3, { priority: 1 }), at);
      await tx.harnessItems.write.insert(itemOf(0x900, 1, { priority: 1 }), at);
      return (await tx.harnessItems.read.forHarness(uid(0x900))).map((item) => item.title);
    });
    expect(order).toEqual(['Item 1', 'Item 3', 'Item 2', 'Item 4']);
  });
}

function fourItems(base: number) {
  return {
    one: itemOf(base, 1),
    two: itemOf(base, 2),
    three: itemOf(base, 3),
    four: itemOf(base, 4),
  };
}

async function insertAll(tx: StoreTransaction, items: readonly ItemState[]): Promise<void> {
  for (const item of items) await tx.harnessItems.write.insert(item, at);
}

function claimRequest(item: ItemState, holder: string, lease: number | null, now: Date) {
  return {
    itemId: item.itemId,
    holder: identitySchema.parse(holder),
    claimantKind: 'agent' as const,
    delegationId: null,
    leaseExpiresAt: lease === null ? null : new Date(now.getTime() + lease),
    at: now,
  };
}

function describeClaims(subject: () => GatewaySubject): void {
  it('DX-3 claims an unheld item once, refuses a held one, and takes a lapsed lease', async () => {
    const item = itemOf(0xa00, 1);
    const results = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xa00, 'gateway-claim');
      await tx.harnessItems.write.insert(item, at);
      const first = await tx.harnessItems.write.claim(claimRequest(item, 'agent:one', hour, at));
      const held = await tx.harnessItems.write.claim(claimRequest(item, 'agent:two', hour, at));
      const after = new Date(at.getTime() + 2 * hour);
      const lapsed = await tx.harnessItems.write.claim(
        claimRequest(item, 'agent:two', hour, after),
      );
      return {
        first,
        held,
        lapsed,
        holder: (await tx.harnessItems.read.byId(item.itemId))?.holder,
      };
    });
    expect(results).toEqual({ first: true, held: false, lapsed: true, holder: 'agent:two' });
  });
}

function describeLeases(subject: () => GatewaySubject): void {
  it('DX-3 counts only live holders in a stage', async () => {
    const { one, two, three, four } = fourItems(0xb00);
    const counts = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xb00, 'gateway-held');
      await insertAll(tx, [one, two, three, four]);
      await tx.harnessItems.write.claim(claimRequest(one, 'agent:one', null, at));
      await tx.harnessItems.write.claim(claimRequest(two, 'agent:one', hour, at));
      await tx.harnessItems.write.claim(claimRequest(three, 'agent:one', 1_000, at));
      const now = new Date(at.getTime() + 60_000);
      return [
        await tx.harnessItems.read.heldInStage(uid(0xb00), 'build', now),
        await tx.harnessItems.read.heldInStage(uid(0xb00), 'review', now),
      ];
    });
    expect(counts).toEqual([2, 0]);
  });

  it('DX-3 lists lapsed leases in expiry order', async () => {
    const { one, two, three, four } = fourItems(0xc00);
    const lapsed = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xc00, 'gateway-lapsed');
      await insertAll(tx, [one, two, three, four]);
      await tx.harnessItems.write.claim(claimRequest(one, 'agent:one', 3_000, at));
      await tx.harnessItems.write.claim(claimRequest(two, 'agent:one', 1_000, at));
      await tx.harnessItems.write.claim(claimRequest(three, 'agent:one', hour, at));
      const ids = new Set([one, two, three, four].map((item) => item.itemId));
      const now = new Date(at.getTime() + 10_000);
      const all = await tx.harnessItems.read.lapsedLeases(now, 1_000);
      return {
        mine: all.filter((id) => ids.has(id)),
        cappedIsFirst: (await tx.harnessItems.read.lapsedLeases(now, 1)).join() === all[0],
      };
    });
    expect(lapsed).toEqual({ mine: [two.itemId, one.itemId], cappedIsFirst: true });
  });
}

type LockRace = { readonly order: string[]; readonly second: ItemState | null };

async function itemLockRace(
  subject: GatewaySubject,
  itemId: string,
  firstWork: (tx: StoreTransaction, item: ItemState) => Promise<void> = async () => undefined,
): Promise<LockRace> {
  const order: string[] = [];
  let signal: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const first = subject.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item !== null) await firstWork(tx, item);
    signal();
    await awaitBlocked(subject.lockWaiters);
    order.push('first finished');
  });
  await held;
  const second = subject.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    order.push('second locked');
    return item;
  });
  const [, locked] = await Promise.all([first, second]);
  return { order, second: locked };
}

function describeItemLock(subject: () => GatewaySubject): void {
  it('DX-3 holds a second transaction on an item row lock until the first commits', async () => {
    const item = itemOf(0xe00, 1);
    await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xe00, 'gateway-row-lock');
      await tx.harnessItems.write.insert(item, at);
    });
    const race = await itemLockRace(subject(), item.itemId);
    expect(race.order).toEqual(['first finished', 'second locked']);
  });

  it('DX-3 finds the item at its new stage when the lock waited on a stage move', async () => {
    const item = itemOf(0xe80, 1);
    await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xe80, 'gateway-row-lock-move');
      await tx.harnessItems.write.insert(item, at);
    });
    const race = await itemLockRace(subject(), item.itemId, (tx, locked) =>
      tx.harnessItems.write.project({ ...locked, stageKey: 'review' }),
    );
    expect(race).toEqual({
      order: ['first finished', 'second locked'],
      second: { ...item, stageKey: 'review' },
    });
  });
}

function factsOf(page: SeededPage): PageFacts {
  const { id, type, status, jdArea, title, bodyMd, frontmatter } = page;
  return { id, type, status, jdArea, title, bodyMd, frontmatter, version: 1 };
}

function describePages(subject: () => GatewaySubject): void {
  it('DX-3 reads page facts for the ids it is given', async () => {
    const page: SeededPage = {
      id: uid(0xd00),
      type: 'skill',
      status: 'draft',
      jdArea: '80-89',
      bodyMd: 'facts body',
      frontmatter: { name: 'gateway-facts', description: 'Facts carry the frontmatter' },
      slug: 'gateway-facts',
      title: 'Gateway facts',
    };
    await subject().seedPage(page);
    const earlier: SeededPage = {
      ...page,
      id: uid(0xcff),
      slug: 'gateway-facts-earlier',
      title: 'Gateway facts earlier',
      bodyMd: 'earlier body',
      frontmatter: {},
    };
    await subject().seedPage(earlier);
    const facts = await subject().store.transaction(async (tx) => ({
      found: await tx.pages.read.facts([page.id, uid(0xd01), earlier.id]),
      none: await tx.pages.read.facts([]),
    }));
    expect(facts).toEqual({
      found: [factsOf(earlier), factsOf(page)],
      none: [],
    });
  });
}

function decisionOf(base: number, n: number, actor: string, decidedAt: Date): GateDecisionRow {
  return {
    id: uid(base + 0x80 + n),
    harnessId: uid(base),
    itemId: uid(base + 11),
    stageId: uid(base + 2),
    actor: identitySchema.parse(actor),
    decision: 'approve',
    reason: null,
    evidence: { findings: [], gateTarget: null },
    traceId: uid(base + 0x90 + n),
    decidedAt,
  };
}

async function seedDecisionItem(tx: StoreTransaction, base: number, key: string): Promise<void> {
  await seedHarness(tx, base, key);
  await tx.harnessItems.write.insert(itemOf(base, 1), at);
}

function describeGateDecisions(subject: () => GatewaySubject): void {
  it('DX-3 inserts gate decisions and reads them for an item by decision time, then id', async () => {
    const later = decisionOf(0x1300, 1, 'human:ian', new Date(at.getTime() + hour));
    const tied = decisionOf(0x1300, 3, 'human:kim', at);
    const first = { ...decisionOf(0x1300, 2, 'human:kim', at), decision: 'reject' as const };
    const rows = await subject().store.transaction(async (tx) => {
      await seedDecisionItem(tx, 0x1300, 'gateway-gate-decisions');
      await tx.gateDecisions.write.insert(later);
      await tx.gateDecisions.write.insert(tied);
      await tx.gateDecisions.write.insert({ ...first, reason: 'not yet' });
      return {
        found: await tx.gateDecisions.read.forItem(uid(0x1300 + 11)),
        none: await tx.gateDecisions.read.forItem(uid(0x13fe)),
      };
    });
    expect(rows).toEqual({ found: [{ ...first, reason: 'not yet' }, tied, later], none: [] });
  });

  it('DX-3 refuses a gate decision whose actor is an agent, naming gate_decisions_actor_is_human', async () => {
    const outcome = await refusedBy(async (tx) => {
      await seedDecisionItem(tx, 0x1400, 'gateway-gate-decisions-agent');
      await tx.gateDecisions.write.insert(decisionOf(0x1400, 1, 'agent:builder', at));
    }, subject().store);
    expect(outcome).toMatchObject({
      code: '23514',
      constraint: 'gate_decisions_actor_is_human',
      table: 'gate_decisions',
    });
  });
}

export function describeStoreGateways(
  adapter: string,
  subject: () => GatewaySubject,
  concurrentConnections: boolean,
): void {
  describe(`DX-3 store gateways on ${adapter}`, () => {
    describeHarnesses(subject);
    describeHarnessRepositories(subject);
    describeStages(subject);
    describeMissingStage(subject);
    describeInstructions(subject);
    describeProjection(subject);
    describeItemIssues(subject);
    describeItemOrder(subject);
    describeClaims(subject);
    describeLeases(subject);
    describePages(subject);
    describeEvents(subject);
    describeDelegations(subject);
    describeGateDecisions(subject);
    if (concurrentConnections) describeItemLock(subject);
  });
}
