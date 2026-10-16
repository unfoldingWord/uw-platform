import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  readSpend,
  simAgent,
  simCaller,
  simDelegate,
  simPerson,
} from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simAtShip,
  simLendMerge,
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
};

type Options = { readonly protectedPaths?: readonly string[]; readonly shadow?: boolean };

async function inScene(options: Options, work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software, options);
    const input = {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change: standardChange,
    };
    const item = await simAtShip(world, input);
    const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
    world.adapters.githubFacts.given(
      greenFacts(world, { itemId: item.itemId, head: standardChange.head, reviews }),
    );
    await work({ world, admin, harnessId: harness.id, item });
  } finally {
    await world.close();
  }
}

function claim(scene: Scene, agent: Principal, delegationId: string | null) {
  return scene.world.kernel.items.claim(simCaller(scene.world, agent), {
    itemId: scene.item.itemId,
    delegationId,
  });
}

function submit(scene: Scene, agent: Principal) {
  const input = { itemId: scene.item.itemId, to: null, evidence: {}, change: null };
  return scene.world.kernel.items.submit(simCaller(scene.world, agent), input);
}

async function claimAndSubmit(scene: Scene, loan: MergeLoan) {
  expect((await claim(scene, loan.agent, loan.delegationId)).status).toBe('accepted');
  return submit(scene, loan.agent);
}

function rows(scene: Scene) {
  return scene.world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(scene.item.itemId),
  );
}

function lastEvent(scene: Scene) {
  return itemLog(scene.world, scene.harnessId, scene.item.itemId).then((log) => log.events.at(-1));
}

async function writesOneDecision(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  const submitted = await claimAndSubmit(scene, loan);
  expect(submitted).toMatchObject({
    status: 'accepted',
    value: { result: 'parked', failures: [] },
  });
  const [row, ...more] = await rows(scene);
  expect(more).toEqual([]);
  expect(row).toMatchObject({
    actor: scene.admin.identity,
    agentActor: loan.agent.identity,
    delegationId: loan.delegationId,
    decision: 'approve',
    evidence: {
      connector: 'merge',
      head: standardChange.head,
      delegation: {
        delegationId: loan.delegationId,
        personId: scene.admin.personId,
        maxTier: 'standard',
      },
    },
  });
  expect(await lastEvent(scene)).toMatchObject({
    name: 'gate_approved',
    actor: loan.agent.identity,
  });
  expect(scene.world.adapters.connectors.calls()).toEqual([]);
}

async function approverIsGrantor(scene: Scene): Promise<void> {
  const kim = await simPerson(scene.world, 8, [
    { role: 'admin', scopeKind: 'org', scopeArea: null },
  ]);
  const loan = await simLendMerge(scene.world, kim, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  await claimAndSubmit(scene, loan);
  const [row] = await rows(scene);
  expect(row?.actor).toBe(kim.identity);
  expect(row?.actor).not.toBe(scene.admin.identity);
}

async function secondSubmitRefused(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  await claimAndSubmit(scene, loan);
  expect(await submit(scene, loan.agent)).toMatchObject({
    status: 'error',
    reason: 'not_permitted',
  });
  expect(await rows(scene)).toHaveLength(1);
}

async function revokedAfterClaim(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  expect((await claim(scene, loan.agent, loan.delegationId)).status).toBe('accepted');
  const revoked = await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.admin), {
    delegationId: loan.delegationId,
  });
  expect(revoked.status).toBe('accepted');
  expect(await submit(scene, loan.agent)).toMatchObject({
    status: 'error',
    reason: 'delegation_lapsed',
  });
  expect(await rows(scene)).toEqual([]);
}

async function pollOffersShip(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'low',
  });
  const offered = await scene.world.kernel.reads.poll(simCaller(scene.world, loan.agent), {
    harnessId: scene.harnessId,
    limit: 10,
  });
  expect(offered).toMatchObject({ status: 'accepted' });
  expect(offered.status === 'accepted' && offered.value.map((entry) => entry.itemId)).toContain(
    scene.item.itemId,
  );
  await simDelegate(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    persona: 'agent:builder',
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  const builder = simAgent(scene.admin, 'builder', { interactive: false });
  const shown = await scene.world.kernel.reads.poll(simCaller(scene.world, builder), {
    harnessId: scene.harnessId,
    limit: 10,
  });
  expect(shown.status === 'accepted' && shown.value.map((entry) => entry.itemId)).not.toContain(
    scene.item.itemId,
  );
}

async function protectedPath(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  const submitted = await claimAndSubmit(scene, loan);
  expect(submitted).toMatchObject({
    status: 'accepted',
    value: { result: 'parked', failures: ['protected_path_needs_person'] },
  });
  expect(await lastEvent(scene)).toMatchObject({
    name: 'ship_refused',
    evidence: { reasons: ['protected_path_needs_person'] },
  });
  expect(await rows(scene)).toEqual([]);
  const decided = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: standardChange.head,
  });
  expect(decided).toMatchObject({ status: 'accepted', value: { advanced: true } });
  expect(await rows(scene)).toMatchObject([
    { actor: scene.admin.identity, agentActor: null, delegationId: null },
  ]);
}

async function tierAbove(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'low',
  });
  const submitted = await claimAndSubmit(scene, loan);
  expect(submitted).toMatchObject({
    status: 'accepted',
    value: { failures: ['tier_above_delegation'] },
  });
  expect(await rows(scene)).toEqual([]);
}

async function claimWithoutDelegation(scene: Scene): Promise<void> {
  const device = simAgent(scene.admin, `${scene.admin.personId}/laptop`, { interactive: true });
  expect(await claim(scene, device, null)).toMatchObject({
    status: 'error',
    reason: 'delegation_required',
  });
  expect(await lastEvent(scene)).toMatchObject({
    name: 'delegation_required',
    evidence: { stage: 'ship' },
  });
}

async function buildAndDeploy(scene: Scene): Promise<void> {
  const granted = await simDelegate(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    persona: 'agent:builder',
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  const buildId = granted.status === 'accepted' ? granted.value.id : '';
  await readSpend(scene.world);
  const builder = simAgent(scene.admin, 'builder', { interactive: false });
  expect(await claim(scene, builder, buildId)).toMatchObject({
    status: 'error',
    reason: 'pickup_not_allowed',
  });
  const edited = await scene.world.kernel.stages.updateStage(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    stageKey: 'ship',
    change: { connector: 'deploy' },
  });
  expect(edited.status).toBe('accepted');
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  expect(await claim(scene, loan.agent, loan.delegationId)).toMatchObject({
    status: 'error',
    reason: 'pickup_not_allowed',
  });
}

async function shadowHarness(scene: Scene): Promise<void> {
  const loan = await simLendMerge(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    maxTier: 'standard',
  });
  const submitted = await claimAndSubmit(scene, loan);
  expect(submitted).toMatchObject({
    status: 'accepted',
    value: { result: 'parked', failures: ['shadow'] },
  });
  expect(await rows(scene)).toEqual([]);
}

describe('MD-3 an agent under a merge delegation takes the Ship exit, and the record names the grantor', () => {
  it('MD-3 writes one decision: the grantor approves, the agent acts, the delegation is named; nothing merges yet', () =>
    inScene({}, writesOneDecision));

  it('MD-3 the approver is whoever granted the delegation', () => inScene({}, approverIsGrantor));

  it('MD-3 a second submit is refused not_permitted, holding nothing, and writes no second decision', () =>
    inScene({}, secondSubmitRefused));

  it('MD-3 a delegation revoked after the claim refuses the submit delegation_lapsed and writes nothing', () =>
    inScene({}, revokedAfterClaim));

  it('MD-3 poll_queue offers the Ship item under a merge delegation and not under a build one', () =>
    inScene({}, pollOffersShip));
});

describe('MD-4 what a merge delegation never covers', () => {
  it('MD-4 a protected path is refused protected_path_needs_person and the item waits for a person, who can approve', () =>
    inScene({ protectedPaths: ['apps/uw-app/'] }, protectedPath));

  it('MD-4 a standard change under a low delegation is refused tier_above_delegation', () =>
    inScene({}, tierAbove));

  it('MD-4 an agent claiming at Ship without a delegation is refused delegation_required, which is recorded', () =>
    inScene({}, claimWithoutDelegation));

  it('MD-4 a build delegation is refused pickup at Ship, and a merge delegation at a deploy stage', () =>
    inScene({}, buildAndDeploy));

  it('MD-4 a shadow harness never takes the delegated exit', () =>
    inScene({ shadow: true }, shadowHarness));
});
