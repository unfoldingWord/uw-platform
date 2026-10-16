import assert from 'node:assert/strict';
import type { RequiredCheck } from '@uw/contracts';
import { readAllEvents, type PullRequestRef, type ReviewRequest } from '@uw/harness';
import { simAdvance, simCaller, simSystem } from './fixtures.ts';
import {
  approveVerdict,
  joinedFacts,
  joinedHead,
  joinedPull,
  joinedRepository,
  joinRequest,
  startReview,
  type JoinedWorld,
} from './joining.ts';
import { value } from './runs.ts';
import { approvedBy, itemLog, simSha, type MergeLoan } from './ship-fixtures.ts';

type JoinedChange = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly title: string;
  readonly paths: readonly string[];
};

export type ShadowRound = {
  readonly shadowVerdicts: number;
  readonly recorded: number;
  readonly compared: number;
};

export type DelegatedMerge = {
  readonly itemId: string;
  readonly joined: boolean;
  readonly grantor: string;
};

type PostedReviews = () => readonly ReviewRequest[];

export const protectedDirectory = 'src/auth/';

export const joinedChecks: readonly RequiredCheck[] = [
  { app: 'github-actions', name: 'test' },
  { app: 'github-actions', name: 'build' },
];

const mergedChange: JoinedChange = {
  pullRequest: { repo: joinedRepository, number: 13 },
  head: simSha('d00d'),
  title: 'Add the export button',
  paths: ['src/export/button.tsx'],
};

const protectedChange: JoinedChange = {
  pullRequest: { repo: joinedRepository, number: 14 },
  head: simSha('5afe'),
  title: 'Shorten the session',
  paths: [`${protectedDirectory}session.ts`],
};

const reviewerLogin = 'uw-reviewer[bot]';
const firstApprovalId = 9300000000;

async function eventNames(scene: JoinedWorld, itemId: string): Promise<readonly string[]> {
  const log = await itemLog(scene.world, scene.harnessId, itemId);
  return log.events.map((event) => event.name);
}

function count(names: readonly string[], name: string): number {
  return names.filter((found) => found === name).length;
}

async function placeOf(scene: JoinedWorld, itemId: string): Promise<string> {
  const item = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.byId(itemId),
  );
  return `${item?.stageKey ?? 'missing'} ${item?.gateStatus ?? 'missing'}`;
}

export async function shadowRound(scene: JoinedWorld, posted: PostedReviews): Promise<ShadowRound> {
  const { world } = scene;
  value(await world.kernel.gates.recordShadowVerdicts(scene.ingest, { pullRequest: joinedPull }));
  const runId = await startReview(scene);
  value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
  assert.deepEqual(posted(), []);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  const comparison = value(
    await world.kernel.views.shadow(simCaller(world, scene.admin), { harnessId: scene.harnessId }),
  );
  assert.equal(comparison.rows[0]?.head, joinedHead);
  assert.equal(comparison.rows[0]?.reviewer?.verdict, 'approve');
  const names = await eventNames(scene, scene.itemId);
  return {
    shadowVerdicts: count(names, 'shadow_verdict'),
    recorded: count(names, 'review_verdict_recorded'),
    compared: comparison.rows.length,
  };
}

async function harnessEventNames(scene: JoinedWorld): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.map((event) => event.name);
}

export async function liftAndPost(scene: JoinedWorld, reviews: PostedReviews): Promise<number> {
  const { world } = scene;
  const lift = simCaller(world, scene.admin);
  const lifted = value(await world.kernel.stages.liftShadow(lift, { harnessId: scene.harnessId }));
  assert.equal(lifted.harness.shadow, false);
  assert.equal((await harnessEventNames(scene)).includes('shadow_lifted'), true);
  const runId = await startReview(scene);
  value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
  const posted = reviews();
  assert.deepEqual(
    posted.map((review) => [review.pullRequest, review.head, review.verdict]),
    [[joinedPull, joinedHead, 'approve']],
  );
  assert.equal(count(await eventNames(scene, scene.itemId), 'review_verdict_recorded'), 1);
  assert.equal(await placeOf(scene, scene.itemId), 'check working');
  return posted.length;
}

export async function waitsForAPerson(scene: JoinedWorld): Promise<string> {
  const { world, admin } = scene;
  const parked = await simAdvance(world, {
    harnessId: scene.harnessId,
    itemId: scene.itemId,
    worker: admin,
    through: ['check', 'ship'],
  });
  const place = `${parked.stageKey} ${parked.gateStatus}`;
  assert.equal(place, 'ship parked');
  const { rows } = await world.kernel.views.gates(simCaller(world, admin));
  assert.deepEqual(
    rows.map((row) => row.item.itemId),
    [scene.itemId],
  );
  assert.deepEqual((await itemLog(world, scene.harnessId, scene.itemId)).decisions, []);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  return place;
}

async function joinedAtShip(scene: JoinedWorld, change: JoinedChange): Promise<string> {
  const { world } = scene;
  const approval = firstApprovalId + change.pullRequest.number;
  const reviews = [approvedBy(reviewerLogin, 'deepinfra', change.head, approval)];
  const { pullRequest: ref, head, paths } = change;
  world.adapters.githubFacts.given(joinedFacts(world, { ref, head, paths, reviews }));
  const joining = { pullRequest: ref, head, title: change.title };
  const { item } = value(await joinRequest(world, joining));
  const atShip = await simAdvance(world, {
    harnessId: scene.harnessId,
    itemId: item.itemId,
    worker: scene.admin,
    through: ['check'],
  });
  assert.equal(`${atShip.stageKey} ${atShip.gateStatus}`, 'ship working');
  return item.itemId;
}

async function agentSubmitsAtShip(scene: JoinedWorld, loan: MergeLoan, itemId: string) {
  const agent = simCaller(scene.world, loan.agent);
  const { items } = scene.world.kernel;
  value(await items.claim(agent, { itemId, delegationId: loan.delegationId }));
  return value(await items.submit(agent, { itemId, to: null, evidence: {}, change: null }));
}

async function decidedByGrantor(
  scene: JoinedWorld,
  loan: MergeLoan,
  itemId: string,
): Promise<string> {
  const [decision] = await scene.world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(itemId),
  );
  assert.deepEqual(
    [decision?.actor, decision?.agentActor, decision?.delegationId],
    [scene.admin.identity, loan.agent.identity, loan.delegationId],
  );
  return decision?.actor ?? '';
}

function mergedAtItsOwnRef(scene: JoinedWorld): boolean {
  const [merge] = scene.world.adapters.connectors.calls();
  assert.deepEqual(
    [merge?.connector, merge?.joined, merge?.pullRequest, merge?.expectedHead, merge?.repository],
    ['merge', true, mergedChange.pullRequest, mergedChange.head, joinedRepository],
  );
  return merge?.joined ?? false;
}

async function listedUnder(scene: JoinedWorld, itemId: string): Promise<void> {
  const { world } = scene;
  const { rows } = await world.kernel.views.delegatedMerges(simCaller(world, scene.admin));
  assert.deepEqual(
    rows.map((row) => [row.itemId, row.email]),
    [[itemId, scene.admin.email]],
  );
}

export async function mergedUnderDelegation(
  scene: JoinedWorld,
  loan: MergeLoan,
): Promise<DelegatedMerge> {
  const { world } = scene;
  const itemId = await joinedAtShip(scene, mergedChange);
  const submitted = await agentSubmitsAtShip(scene, loan, itemId);
  assert.deepEqual(submitted.failures, []);
  const grantor = await decidedByGrantor(scene, loan, itemId);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  const exits = await world.kernel.gates.exitDelegated(simCaller(world, simSystem()), {
    limit: 20,
  });
  assert.deepEqual(value(exits), { exited: [{ itemId, advanced: true }], failed: [] });
  const joined = mergedAtItsOwnRef(scene);
  assert.equal((await eventNames(scene, itemId)).includes('delegated_merge'), true);
  assert.equal(await placeOf(scene, itemId), 'ship done');
  await listedUnder(scene, itemId);
  return { itemId, joined, grantor };
}

export async function refusedForProtectedPath(
  scene: JoinedWorld,
  loan: MergeLoan,
): Promise<readonly string[]> {
  const { world } = scene;
  const itemId = await joinedAtShip(scene, protectedChange);
  const submitted = await agentSubmitsAtShip(scene, loan, itemId);
  assert.deepEqual(submitted.failures, ['protected_path_needs_person']);
  assert.equal(`${submitted.item.stageKey} ${submitted.item.gateStatus}`, 'ship parked');
  const log = await itemLog(world, scene.harnessId, itemId);
  assert.equal(log.events.at(-1)?.name, 'ship_refused');
  assert.deepEqual(log.decisions, []);
  assert.equal(world.adapters.connectors.calls().length, 1);
  return submitted.failures;
}
