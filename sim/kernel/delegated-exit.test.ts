import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simSystem } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simAtShip,
  simLendMerge,
  simSha,
  standardChange,
  type MergeLoan,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly item: ItemState;
  readonly loan: MergeLoan;
};

const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];

async function decided(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const input = {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change: standardChange,
    };
    const item = await simAtShip(world, input);
    world.adapters.githubFacts.given(
      greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
    );
    const loan = await simLendMerge(world, admin, { harnessId: harness.id, maxTier: 'standard' });
    const caller = simCaller(world, loan.agent);
    await world.kernel.items.claim(caller, {
      itemId: item.itemId,
      delegationId: loan.delegationId,
    });
    const submitted = await world.kernel.items.submit(caller, {
      itemId: item.itemId,
      to: null,
      evidence: {},
      change: null,
    });
    expect(submitted).toMatchObject({ status: 'accepted', value: { failures: [] } });
    await work({ world, admin, harnessId: harness.id, item, loan });
  } finally {
    await world.close();
  }
}

function runExits(scene: Scene, actor: Principal = simSystem()) {
  return scene.world.kernel.gates.exitDelegated(simCaller(scene.world, actor), { limit: 20 });
}

function names(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.item.itemId).then((log) =>
    log.events.map((event) => event.name),
  );
}

function lastEvent(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.item.itemId).then((log) => log.events.at(-1));
}

function exitedNothingLapsed(scene: Scene) {
  return runExits(scene).then(async (outcome) => {
    expect(outcome).toEqual({
      status: 'accepted',
      value: { exited: [{ itemId: scene.item.itemId, advanced: false }] },
    });
    expect(scene.world.adapters.connectors.calls()).toEqual([]);
    expect(await lastEvent(scene)).toMatchObject({
      name: 'connector_refused',
      evidence: { connector: 'merge', reason: 'delegation_lapsed' },
    });
  });
}

async function mergesNamingTheGrantor(scene: Scene): Promise<void> {
  expect(await runExits(scene)).toEqual({
    status: 'accepted',
    value: { exited: [{ itemId: scene.item.itemId, advanced: true }] },
  });
  const [call, ...more] = scene.world.adapters.connectors.calls();
  expect(more).toEqual([]);
  expect(call).toMatchObject({
    connector: 'merge',
    expectedHead: standardChange.head,
    joined: false,
  });
  const after = await names(scene);
  const merged = after.indexOf('connector_succeeded');
  expect(after.slice(merged, merged + 3)).toEqual([
    'connector_succeeded',
    'delegated_merge',
    'stage_advanced',
  ]);
  const log = await itemLog(scene.world, scene.harnessId, scene.item.itemId);
  expect(log.events.find((event) => event.name === 'delegated_merge')?.evidence).toMatchObject({
    delegationId: scene.loan.delegationId,
    personId: scene.admin.personId,
    email: scene.admin.email,
    persona: scene.loan.agent.identity,
    maxTier: 'standard',
  });
}

async function onlyTheSystem(scene: Scene): Promise<void> {
  expect(await runExits(scene, scene.admin)).toMatchObject({
    status: 'error',
    reason: 'not_permitted',
  });
  expect(await runExits(scene, scene.loan.agent)).toMatchObject({
    status: 'error',
    reason: 'not_permitted',
  });
  expect(scene.world.adapters.connectors.calls()).toEqual([]);
}

async function secondRunExitsNothing(scene: Scene): Promise<void> {
  await runExits(scene);
  expect(await runExits(scene)).toEqual({ status: 'accepted', value: { exited: [] } });
  expect(scene.world.adapters.connectors.calls()).toHaveLength(1);
}

async function revokedStopsTheMerge(scene: Scene): Promise<void> {
  await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.admin), {
    delegationId: scene.loan.delegationId,
  });
  await exitedNothingLapsed(scene);
}

async function grantorLostAdminStops(scene: Scene): Promise<void> {
  for (const grant of scene.admin.grants) {
    const at = scene.world.adapters.clock.now();
    await revokeSeededGrant(scene.world.database.db, grant.grantId, at);
  }
  await exitedNothingLapsed(scene);
}

async function movedHeadRefused(scene: Scene): Promise<void> {
  const moved = greenFacts(scene.world, {
    itemId: scene.item.itemId,
    head: simSha('c0de'),
    reviews,
  });
  scene.world.adapters.githubFacts.given(moved);
  await runExits(scene);
  expect(scene.world.adapters.connectors.calls()).toEqual([]);
  expect((await lastEvent(scene))?.evidence['reason']).toMatch(
    /^ship_rule_refused: .*head_mismatch/,
  );
}

async function pastFifteenMinutes(scene: Scene): Promise<void> {
  scene.world.adapters.clock.advance(16 * 60_000);
  expect(await runExits(scene)).toEqual({ status: 'accepted', value: { exited: [] } });
  expect(scene.world.adapters.connectors.calls()).toEqual([]);
}

describe('MD-3 the minute job merges a delegated decision after running the ship rule again', () => {
  it('MD-3 merges the evaluated head and records delegated_merge with the merge, naming the grantor', () =>
    decided(mergesNamingTheGrantor));
  it('MD-3 only the system principal runs it', () => decided(onlyTheSystem));
  it('MD-3 a second run exits nothing, and the merge ran once', () =>
    decided(secondRunExitsNothing));
  it('MD-3 a delegation revoked after the decision stops the merge', () =>
    decided(revokedStopsTheMerge));
  it('MD-3 a grantor who lost admin after the decision stops the merge as a lapsed delegation', () =>
    decided(grantorLostAdminStops));
  it('MD-3 a head moved after the decision is refused by the second run of the rule', () =>
    decided(movedHeadRefused));
  it('MD-3 past fifteen minutes the job leaves the decision to a person', () =>
    decided(pastFifteenMinutes));
});
