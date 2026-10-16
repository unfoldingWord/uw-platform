import { systemIdentity, type HarnessEvent, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, type PlaneIndicator } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend, simAgent, simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import { planeStart, planeWorld, seedPlaneLearnings, type PlaneWorld } from '../plane.ts';
import { gatesWorld, type GatesWorld } from '../views.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const day = 86_400_000;

async function inPlane(work: (scene: PlaneWorld) => Promise<void>): Promise<void> {
  const world = await createWorld(planeStart);
  try {
    await work(await planeWorld(world));
  } finally {
    await world.close();
  }
}

async function inGates(work: (scene: GatesWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await gatesWorld(world));
  } finally {
    await world.close();
  }
}

function totalsOf(world: World) {
  return world.kernel.views.planeTotals({ at: world.adapters.clock.now() });
}

function listOf(world: World, actor: Principal, indicator: PlaneIndicator) {
  return world.kernel.views.planeList(simCaller(world, actor), indicator);
}

async function spendThisMonth(scene: PlaneWorld): Promise<void> {
  const { spend } = await totalsOf(scene.world);
  expect(spend).toEqual({
    meteredMinor: 6,
    computeMinor: 0,
    subscriptionTokens: 1200,
    currency: 'USD',
    since: new Date('2026-10-01T00:00:00.000Z'),
  });
}

async function runsToday(scene: PlaneWorld): Promise<void> {
  const { runsToday: today } = await totalsOf(scene.world);
  expect(today.byShape).toEqual({ 'workflow-run': 1, 'external-run': 1 });
  expect(today.byEngine).toEqual({ 'claude-messages': 1, external: 1 });
  expect(today.since).toEqual(new Date('2026-10-01T00:00:00.000Z'));
}

async function liveDelegations(scene: PlaneWorld): Promise<void> {
  const { liveDelegations: live } = await totalsOf(scene.world);
  expect(live).toEqual({ count: 3, merge: 0, soonestExpiry: scene.scoutExpiry });
}

async function decide(scene: GatesWorld, actor: Principal, itemId: string): Promise<void> {
  await scene.world.kernel.gates.decide(simCaller(scene.world, actor), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, itemId),
  });
}

async function refusalsByReason(scene: GatesWorld): Promise<void> {
  await decide(scene, scene.areaAdmin, scene.high);
  scene.world.adapters.clock.advance(7 * day + 60_000);
  await decide(scene, scene.areaAdmin, scene.high);
  await decide(scene, simAgent(scene.ian, 'reviewer', { interactive: true }), scene.standard);
  const { gateRefusals } = await totalsOf(scene.world);
  expect(gateRefusals).toEqual({
    byReason: {
      approver_lacks_domain_grant: 1,
      gate_refused_to_agent: 1,
      no_reviewer_approval: 1,
      reviewer_count_below_tier: 1,
    },
    capped: false,
  });
}

async function eventsOf(world: World, harnessIds: readonly string[]): Promise<HarnessEvent[]> {
  const all: HarnessEvent[] = [];
  for (const harnessId of harnessIds) {
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, harnessId, null),
    );
    all.push(...events);
  }
  return all;
}

async function agentWrites(scene: PlaneWorld): Promise<void> {
  scene.world.adapters.clock.advance(day - 30 * 60_000);
  await readSpend(scene.world);
  const since = scene.world.adapters.clock.now().getTime() - day;
  const events = await eventsOf(scene.world, [scene.harnessId, scene.elsewhereId]);
  const byAgents = events.filter((event) => !event.actor.startsWith('human:'));
  const recent = byAgents.filter((event) => new Date(event.at).getTime() >= since);
  expect(recent.length).toBeLessThan(byAgents.length);
  expect(recent.some((event) => event.actor === systemIdentity)).toBe(true);
  const expected = recent.filter((event) => event.actor !== systemIdentity).length;
  expect(expected).toBeGreaterThan(0);
  const { agentWrites: writes } = await totalsOf(scene.world);
  expect(writes).toEqual({ count: expected, capped: false });
}

async function staleLearnings(scene: PlaneWorld): Promise<void> {
  await seedPlaneLearnings(scene.world);
  const { staleLearnings: stale } = await totalsOf(scene.world);
  expect(stale).toEqual({ count: 2, capped: false });
  const rows = await listOf(scene.world, scene.admin, 'stale_learnings');
  expect(rows.map((row) => row.cells['title'])).toEqual(['Learning 0', 'Learning 5']);
  expect(rows[0]?.cells).toEqual({
    title: 'Learning 0',
    confidence: 'inferred',
    'review by': '2026-08-30',
  });
}

async function readableRowsOnly(scene: PlaneWorld): Promise<void> {
  await seedPlaneLearnings(scene.world);
  const viewer = await simPerson(scene.world, 8, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const harnessesOf = async (actor: Principal, indicator: PlaneIndicator) =>
    new Set((await listOf(scene.world, actor, indicator)).map((row) => row.harnessId));
  expect(await harnessesOf(scene.admin, 'live_delegations')).toEqual(
    new Set([scene.harnessId, scene.elsewhereId]),
  );
  expect(await harnessesOf(viewer, 'live_delegations')).toEqual(new Set([scene.harnessId]));
  const stale = await listOf(scene.world, viewer, 'stale_learnings');
  expect(stale.map((row) => row.cells['title'])).toEqual(['Learning 0']);
  const stranger = await simPerson(scene.world, 9, []);
  expect(await listOf(scene.world, stranger, 'spend')).toEqual([]);
  const spend = await listOf(scene.world, viewer, 'spend');
  expect(spend.map((row) => [row.cells['shape'], row.cells['cost'], row.cells['tokens']])).toEqual(
    expect.arrayContaining([
      ['workflow-run', '$0.06', 240],
      ['external-run', null, 1200],
    ]),
  );
}

describe('the agent plane', () => {
  it("WB-10 spend totals this month's metered cost apart from the subscription tokens reported", () =>
    inPlane(spendThisMonth));
  it('WB-10 runs today are counted by run shape and by engine', () => inPlane(runsToday));
  it('WB-10 live delegations are counted with the soonest expiry', () => inPlane(liveDelegations));
  it('WB-10 gate refusals in the last 7 days are counted by closed reason', () =>
    inGates(refusalsByReason));
  it('WB-10 agent writes count the events agents appended in the last 24 hours', () =>
    inPlane(agentWrites));
  it('WB-10 stale learnings are assumed or inferred learnings past their review date', () =>
    inPlane(staleLearnings));
  it('WB-10 a drill-through list keeps only rows the caller can read', () =>
    inPlane(readableRowsOnly));
});
