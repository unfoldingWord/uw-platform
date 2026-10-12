import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedOpenItems } from '@uw/db/test-seed';
import { VIEW_LIMIT, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { startOn, value } from '../runs.ts';
import {
  elsewhereLearning,
  gatesWorld,
  grantScout,
  playedScene,
  shownLearning,
  waitingScene,
  type GatesWorld,
  type Played,
  type Waiting,
} from '../views.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inGates(work: (scene: GatesWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await gatesWorld(world));
  } finally {
    await world.close();
  }
}

function gatesIt(title: string, work: (scene: GatesWorld) => Promise<void>): void {
  it(title, () => inGates(work));
}

function callerOf(scene: GatesWorld, actor: Principal): Caller {
  return simCaller(scene.world, actor);
}

async function gateIds(scene: GatesWorld, actor: Principal): Promise<readonly string[]> {
  const { rows } = await scene.world.kernel.views.gates(callerOf(scene, actor));
  return rows.map((row) => row.item.itemId);
}

function byId(ids: readonly string[]): readonly string[] {
  return [...ids].sort();
}

async function decideOf(scene: GatesWorld, actor: Principal, itemId: string) {
  const { rows } = await scene.world.kernel.views.gates(callerOf(scene, scene.ian));
  const row = rows.find((entry) => entry.item.itemId === itemId);
  if (row === undefined) throw new Error(`no gate for ${itemId}`);
  return scene.world.kernel.views.decideAbility(callerOf(scene, actor), row);
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'accepted' ? 'accepted' : outcome.reason;
}

async function decidableListed(scene: GatesWorld): Promise<void> {
  const { rows } = await scene.world.kernel.views.gates(callerOf(scene, scene.areaAdmin));
  expect(rows.map((row) => row.item.itemId)).toEqual(byId([scene.standard, scene.atCheck]));
  expect(rows.map((row) => [row.harness.id, row.stage.key, row.stage.exitGate])).toEqual(
    rows.map((row) => [scene.harnessId, row.item.stageKey, 'human_approval']),
  );
  expect(rows.every((row) => row.item.gateStatus === 'parked')).toBe(true);
  expect(await gateIds(scene, scene.viewer)).toEqual([]);
}

async function domainGrant(scene: GatesWorld): Promise<void> {
  expect(await gateIds(scene, scene.areaAdmin)).not.toContain(scene.high);
  expect(await gateIds(scene, scene.ian)).toEqual(
    byId([scene.standard, scene.high, scene.atCheck]),
  );
}

async function agentsDecideNone(scene: GatesWorld): Promise<void> {
  const agent = simAgent(scene.ian, 'builder', { interactive: true });
  const device = simAgent(scene.ian, `${scene.ian.personId ?? ''}/laptop`, { interactive: true });
  expect(await gateIds(scene, agent)).toEqual([]);
  expect(await gateIds(scene, device)).toEqual([]);
}

async function abilityReasons(scene: GatesWorld): Promise<void> {
  const agent = simAgent(scene.ian, 'builder', { interactive: true });
  expect(await decideOf(scene, scene.ian, scene.high)).toEqual({ can: true });
  expect(await decideOf(scene, scene.areaAdmin, scene.standard)).toEqual({ can: true });
  expect(await decideOf(scene, scene.areaAdmin, scene.high)).toEqual({
    can: false,
    reason: 'approver_lacks_domain_grant',
  });
  const notPermitted = { can: false, reason: 'not_permitted' };
  expect(await decideOf(scene, scene.viewer, scene.standard)).toEqual(notPermitted);
  expect(await decideOf(scene, agent, scene.standard)).toEqual(notPermitted);
}

async function notAtPersonGate(scene: GatesWorld): Promise<void> {
  const caller = callerOf(scene, scene.ian);
  const enqueued = await scene.world.kernel.items.enqueue(caller, {
    harnessId: scene.harnessId,
    title: 'Park me at the backlog',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  const read = value(await scene.world.kernel.reads.item(caller, { itemId }));
  const parked = { ...read.item, gateStatus: 'parked' as const };
  await scene.world.adapters.store.transaction((tx) => tx.harnessItems.write.project(parked));
  const notAtGate = { can: false, reason: 'item_not_at_gate' };
  const ability = (gate: Parameters<typeof scene.world.kernel.views.decideAbility>[1]) =>
    scene.world.kernel.views.decideAbility(caller, gate);
  expect(ability({ harness: read.harness, stage: read.stage, item: parked })).toEqual(notAtGate);
  const asViewer = scene.world.kernel.views.decideAbility(callerOf(scene, scene.viewer), {
    harness: read.harness,
    stage: read.stage,
    item: parked,
  });
  expect(asViewer).toEqual(notAtGate);
  const { rows } = await scene.world.kernel.views.gates(caller);
  const row = rows.find((entry) => entry.item.itemId === scene.standard);
  if (row === undefined) throw new Error('no gate for the standard item');
  expect(ability(row)).toEqual({ can: true });
  expect(ability({ ...row, item: { ...row.item, gateStatus: 'working' } })).toEqual(notAtGate);
}

async function oneGate(scene: GatesWorld): Promise<void> {
  const caller = callerOf(scene, scene.areaAdmin);
  const input = { itemId: scene.standard };
  const at = scene.world.adapters.clock.now();
  expect(await scene.world.kernel.views.gate(caller, input, { at })).toEqual(
    await scene.world.kernel.gates.view(caller, input, { at }),
  );
  const stranger = callerOf(scene, await simPerson(scene.world, 3, []));
  expect(reasonOf(await scene.world.kernel.views.gate(stranger, input))).toBe('item_not_found');
}

async function parkedCapSaysSo(scene: GatesWorld): Promise<void> {
  const caller = callerOf(scene, scene.areaAdmin);
  const before = await scene.world.kernel.views.gates(caller);
  expect(before.capped).toBe(false);
  expect((await scene.world.kernel.views.waitingOn(caller)).gatesCapped).toBe(false);
  await seedOpenItems(scene.world.database.db, {
    harnessId: scene.harnessId,
    stageKey: 'build',
    count: VIEW_LIMIT,
    gateStatus: 'parked',
    priority: -1,
  });
  const after = await scene.world.kernel.views.gates(caller);
  expect(after.capped).toBe(true);
  expect(after.rows.map((row) => row.item.itemId)).toEqual(byId([scene.standard, scene.atCheck]));
  expect((await scene.world.kernel.views.waitingOn(caller)).gatesCapped).toBe(true);
}

async function decidedOnce(scene: GatesWorld): Promise<void> {
  const admin = callerOf(scene, scene.areaAdmin);
  const input = { itemId: scene.standard };
  expect(await scene.world.kernel.views.decided(admin, input)).toBe(false);
  const decision = { ...input, decision: 'reject' as const, reason: null, findings: [] };
  expect(reasonOf(await scene.world.kernel.gates.decide(admin, decision))).toBe('accepted');
  expect(await scene.world.kernel.views.decided(admin, input)).toBe(true);
  const stranger = callerOf(scene, await simPerson(scene.world, 3, []));
  expect(await scene.world.kernel.views.decided(stranger, input)).toBe(false);
}

describe('the gates a person can decide', () => {
  gatesIt(
    'WB-6 the gates list holds parked items at human-approval stages the person can decide',
    decidableListed,
  );
  gatesIt(
    'WB-6 a high item touching acl is absent for an area admin without the org admin grant, and present with it',
    domainGrant,
  );
  gatesIt("WB-6 an agent principal's gates list is empty", agentsDecideNone);
  gatesIt(
    'WB-6 decide ability names approver_lacks_domain_grant when only a domain grant is missing and not_permitted otherwise',
    abilityReasons,
  );
  gatesIt(
    'WB-6 decide ability refuses item_not_at_gate to an admin and a viewer alike unless the item is parked at a stage a person decides',
    notAtPersonGate,
  );
  gatesIt('the views gate read answers the gate view of one item', oneGate);
  gatesIt(
    'the gates list and Home say they are capped when a harness has more parked items than the read takes',
    parkedCapSaysSo,
  );
  gatesIt('the decided read is true once a decision is recorded on a readable item', decidedOnce);
});

async function inWaiting(work: (scene: Waiting) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await waitingScene(world));
  } finally {
    await world.close();
  }
}

async function kindsFor(scene: Waiting, actor: Principal): Promise<readonly string[]> {
  const { rows } = await scene.world.kernel.views.waitingOn(simCaller(scene.world, actor));
  return rows.map((row) => row.kind);
}

async function ranked(scene: Waiting): Promise<void> {
  const { rows } = await scene.world.kernel.views.waitingOn(simCaller(scene.world, scene.owner));
  expect(rows.map((row) => row.kind)).toEqual(['gate', 'delegation_lapsed', 'run_failed']);
  const [, lapsed, failed] = rows;
  expect(lapsed?.kind === 'delegation_lapsed' && lapsed.delegation.persona).toBe('agent:scout');
  expect(failed?.kind === 'run_failed' && [failed.run.id, failed.item.itemId]).toEqual([
    scene.failedRun,
    scene.itemId,
  ]);
}

async function renewedLeaves(scene: Waiting): Promise<void> {
  await grantScout(scene, null);
  expect(await kindsFor(scene, scene.owner)).toEqual(['gate', 'run_failed']);
}

async function retriedLeaves(scene: Waiting): Promise<void> {
  expect(await kindsFor(scene, scene.owner)).toContain('run_failed');
  await readSpend(scene.world);
  value(await startOn(scene));
  expect(await kindsFor(scene, scene.owner)).toEqual(['gate', 'delegation_lapsed']);
}

async function lapsedTwiceShownOnce(scene: Waiting): Promise<void> {
  const { clock } = scene.world.adapters;
  const second = await grantScout(scene, new Date(clock.now().getTime() + 60_000));
  clock.advance(2 * 60_000);
  const { rows } = await scene.world.kernel.views.waitingOn(simCaller(scene.world, scene.owner));
  const lapsed = rows.flatMap((row) => (row.kind === 'delegation_lapsed' ? [row.delegation] : []));
  expect(lapsed.map((delegation) => delegation.id)).toEqual([second.id]);
}

async function nothingWaiting(scene: Waiting): Promise<void> {
  expect(await kindsFor(scene, scene.editor)).toEqual([]);
  const agent = simAgent(scene.owner, 'builder', { interactive: true });
  expect(await kindsFor(scene, agent)).toEqual([]);
}

describe('waiting on me', () => {
  it('WB-9 waiting on me ranks gates, then lapsed delegations, then failed runs', () =>
    inWaiting(ranked));
  it('WB-9 a lapsed delegation that was renewed leaves the list', () => inWaiting(renewedLeaves));
  it('two lapsed delegations for the same persona and harness show as one row, the latest', () =>
    inWaiting(lapsedTwiceShownOnce));
  it('WB-9 a failed run on an item the person ran or holds is listed, and leaves when a later run starts', () =>
    inWaiting(retriedLeaves));
  it('WB-9 nothing waiting answers an empty list', () => inWaiting(nothingWaiting));
});

async function inPlay(work: (scene: Played) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await playedScene(world));
  } finally {
    await world.close();
  }
}

function playOf(scene: Played, actor: Principal, after = 0) {
  const caller = simCaller(scene.world, actor);
  return scene.world.kernel.views.playByPlay(caller, { itemId: scene.itemId, after });
}

async function pagesInOrder(scene: Played): Promise<void> {
  const first = value(await playOf(scene, scene.editor));
  expect([first.events.length, first.next]).toEqual([100, first.events.at(-1)?.position]);
  const rest = value(await playOf(scene, scene.editor, first.next ?? 0));
  expect([rest.events.length, rest.next]).toEqual([6, null]);
  const positions = [...first.events, ...rest.events].map((event) => event.position);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(first.events.slice(0, 3).map((event) => [event.name, event.actor])).toEqual([
    ['item_created', scene.editor.identity],
    ['item_claimed', scene.laptop.actor.identity],
    ['run_started', scene.laptop.actor.identity],
  ]);
  expect([first.item.itemId, first.stage.key]).toEqual([scene.itemId, first.item.stageKey]);
}

async function labelled(scene: Played): Promise<void> {
  const rest = value(await playOf(scene, scene.editor, 100));
  expect(rest.learnings).toEqual({ [shownLearning]: 'inferred', [elsewhereLearning]: 'assumed' });
  const viewer = await simPerson(scene.world, 8, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  expect(value(await playOf(scene, viewer, 100)).learnings).toEqual({
    [shownLearning]: 'inferred',
  });
}

async function hiddenItem(scene: Played): Promise<void> {
  const stranger = await simPerson(scene.world, 3, []);
  const hidden = await playOf(scene, stranger);
  const missingId = '00000000-0000-4000-8000-0000000000ff';
  const missing = await scene.world.kernel.views.playByPlay(simCaller(scene.world, stranger), {
    itemId: missingId,
    after: 0,
  });
  expect(reasonOf(hidden)).toBe('item_not_found');
  expect(JSON.stringify(hidden).replace(scene.itemId, missingId)).toBe(JSON.stringify(missing));
}

describe('the play-by-play', () => {
  it("WB-8 the play-by-play reads the item's events in order, 100 at a time, with each actor's full identity", () =>
    inPlay(pagesInOrder));
  it('WB-8 a learning attached to the item carries its evidence label', () => inPlay(labelled));
  it('an item the caller cannot read is item_not_found on the play-by-play, the same as a missing one', () =>
    inPlay(hiddenItem));
});
