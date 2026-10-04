import assert from 'node:assert/strict';
import { gateLink, type HarnessEvent, type ItemState } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { LEASE_MS } from '@uw/harness';
import { simAdvance } from '../fixtures.ts';
import { beatOf, itemOf, runOf, startOn, stepOn, value } from '../runs.ts';
import { greenFacts, itemLog, namesSince } from '../ship-fixtures.ts';
import type { World } from '../world.ts';
import {
  callerFor,
  changeTo,
  createCast,
  externalStep,
  heads,
  host,
  hostedOn,
  minute,
  pageIds,
  type Cast,
  type Journey,
} from './cast.ts';

const wrongPremise = 'the typo was fixed by an earlier pull request';

async function itemNow(cast: Cast, itemId: string): Promise<ItemState> {
  const item = await itemOf(cast.world, itemId);
  assert.ok(item, `item ${itemId} is missing`);
  return item;
}

function lastNamed(events: readonly HarnessEvent[], name: string): HarnessEvent | undefined {
  return events.filter((event) => event.name === name).at(-1);
}

async function kickstart(cast: Cast): Promise<string> {
  const { world, max } = cast;
  await seedPage(world.database.db, {
    id: pageIds.product,
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    slug: 'board-view',
    title: 'Show the board',
    bodyMd: 'People see their harness as a board of stages.',
    frontmatter: { owner: max.identity, summary: 'The board view of a harness' },
  });
  const created = value(
    await world.kernel.items.enqueue(callerFor(cast, max), {
      harnessId: cast.harnessId,
      title: 'Show the board',
      pageId: pageIds.product,
      priority: null,
      due: null,
      delegationId: null,
    }),
  );
  assert.equal(created.stageKey, 'package');
  assert.equal(created.pageId, pageIds.product);
  return created.itemId;
}

async function wrongItemInScope(cast: Cast): Promise<string> {
  const { world, harnessId } = cast;
  const { itemId } = value(
    await world.kernel.items.enqueue(callerFor(cast, cast.max), {
      harnessId,
      title: 'Fix the typo on the board',
      pageId: null,
      priority: null,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, { harnessId, itemId, worker: cast.max, through: ['package'] });
  return itemId;
}

async function holdTheWrongPremise(cast: Cast): Promise<string> {
  const { world, harnessId } = cast;
  const itemId = await wrongItemInScope(cast);
  const scene = hostedOn(cast, cast.builder, itemId);
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'read' }));
  value(await stepOn(scene, beat, { runId, step: 'scout' }));
  const before = await itemLog(world, harnessId, itemId);
  value(await world.kernel.runs.holdPremise(host(cast), runId, { reason: wrongPremise }));
  const after = await itemLog(world, harnessId, itemId);
  assert.deepEqual(namesSince(before, after), ['premise_held', 'item_released', 'run_completed']);
  assert.deepEqual(lastNamed(after.events, 'premise_held')?.evidence, {
    runId,
    reason: wrongPremise,
  });
  assert.equal((await runOf(world, runId))?.outcome, 'completed');
  const held = await itemNow(cast, itemId);
  assert.deepEqual([held.stageKey, held.holder, held.gateStatus], ['scope', null, 'working']);
  value(await world.kernel.items.claim(cast.laptop, { itemId, delegationId: null }));
  value(await world.kernel.items.release(cast.laptop, { itemId, delegationId: null }));
  return itemId;
}

async function workToCheck(cast: Cast, itemId: string): Promise<void> {
  const { world, harnessId } = cast;
  await simAdvance(world, { harnessId, itemId, worker: cast.max, through: ['package'] });
  const runner = cast.laptop.actor;
  await simAdvance(world, { harnessId, itemId, worker: runner, through: ['scope', 'plan'] });
  const claimed = value(
    await world.kernel.items.claim(cast.laptop, { itemId, delegationId: null }),
  );
  assert.equal(claimed.item.stageKey, 'build');
  assert.equal(claimed.leaseWarning, false);
  const lease = new Date(world.adapters.clock.now().getTime() + LEASE_MS).toISOString();
  assert.equal(claimed.leaseExpiresAt, lease);
  const step = value(
    await world.kernel.items.recordRunStep(cast.laptop, externalStep(cast, itemId)),
  );
  assert.equal(step.leaseWarning, false);
  const undeclared = { itemId, head: heads.first, reviews: [], declaration: null };
  world.adapters.githubFacts.given(greenFacts(world, undeclared));
  const submitted = value(
    await world.kernel.items.submit(cast.laptop, changeTo(itemId, heads.first)),
  );
  assert.equal(submitted.result, 'advanced');
  const { item } = submitted;
  assert.deepEqual(
    [item.stageKey, item.expectedHead, item.riskTier, item.branchState],
    ['check', heads.first, null, 'active'],
  );
  const { events } = await itemLog(world, harnessId, itemId);
  const derived = lastNamed(events, 'risk_derived')?.evidence;
  assert.equal(derived?.['refusal'], 'risk_tier_undeclared');
  assert.equal(derived['declaration'], null);
}

async function sweptAtExpiry(cast: Cast, itemId: string): Promise<void> {
  const { world, harnessId } = cast;
  world.adapters.clock.advance(16 * minute);
  const before = await itemLog(world, harnessId, itemId);
  const swept = value(await world.kernel.items.expireLeases(host(cast), { limit: 10 }));
  const after = await itemLog(world, harnessId, itemId);
  assert.deepEqual(swept.expired, [itemId]);
  assert.deepEqual(namesSince(before, after), ['lease_expired', 'branch_abandoned', 'run_stopped']);
  assert.deepEqual(lastNamed(after.events, 'branch_abandoned')?.evidence, { head: heads.first });
  assert.equal(lastNamed(after.events, 'run_stopped')?.evidence['why'], 'lease_expired');
}

async function lapseAtCheck(cast: Cast, itemId: string): Promise<void> {
  const { world } = cast;
  const claimed = value(
    await world.kernel.items.claim(cast.laptop, { itemId, delegationId: null }),
  );
  assert.equal(claimed.leaseWarning, false);
  world.adapters.clock.advance(13 * minute);
  const warned = value(
    await world.kernel.items.recordRunStep(cast.laptop, externalStep(cast, itemId)),
  );
  assert.equal(warned.leaseWarning, true);
  await sweptAtExpiry(cast, itemId);
  const fresh = value(
    await world.kernel.items.claim(cast.desktop, {
      itemId,
      delegationId: null,
      adoptBranch: false,
    }),
  );
  assert.deepEqual(fresh.branch, {
    name: `harness/${itemId}`,
    startFrom: heads.first,
    adopted: false,
  });
  assert.equal(fresh.item.branchState, 'abandoned');
}

function gateWakesFor(cast: Cast, itemId: string) {
  return cast.world.adapters.notifier
    .delivered()
    .filter((wake) => wake.itemId === itemId && wake.reason === 'gate_waiting');
}

function wokeOnlyDeciders(cast: Cast, itemId: string, earlier: number): void {
  const wakes = gateWakesFor(cast, itemId);
  assert.equal(wakes.length - earlier, 1);
  const wake = wakes.at(-1);
  const deciders = [cast.ian.personId, cast.kim.personId].toSorted();
  assert.deepEqual(wake?.recipients.map((recipient) => recipient.personId).toSorted(), deciders);
  assert.equal(wake.link, gateLink(cast.harnessId, itemId));
}

async function parkAtShip(cast: Cast, itemId: string): Promise<void> {
  const { world } = cast;
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head: heads.second, reviews: [] }));
  const checked = value(
    await world.kernel.items.submit(cast.desktop, changeTo(itemId, heads.second)),
  );
  assert.equal(checked.result, 'advanced');
  const { item } = checked;
  assert.deepEqual(
    [item.stageKey, item.expectedHead, item.riskTier, item.riskDomains, item.branchState],
    ['ship', heads.second, 'standard', [], 'active'],
  );
  const max = callerFor(cast, cast.max);
  value(await world.kernel.items.claim(max, { itemId, delegationId: null }));
  const earlier = gateWakesFor(cast, itemId).length;
  const parked = value(
    await world.kernel.items.submit(max, { itemId, to: null, evidence: {}, change: null }),
  );
  assert.equal(parked.result, 'parked');
  assert.deepEqual([parked.item.stageKey, parked.item.gateStatus], ['ship', 'parked']);
  wokeOnlyDeciders(cast, itemId, earlier);
}

export async function travelToShip(world: World): Promise<Journey> {
  const cast = await createCast(world);
  const itemId = await kickstart(cast);
  const wrongItemId = await holdTheWrongPremise(cast);
  await workToCheck(cast, itemId);
  await lapseAtCheck(cast, itemId);
  await parkAtShip(cast, itemId);
  return { cast, itemId, wrongItemId };
}
