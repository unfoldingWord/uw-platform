import assert from 'node:assert/strict';
import type { HarnessEvent } from '@uw/contracts';
import type { Caller, PullRequestFacts } from '@uw/harness';
import { simIngest, simSeenHead } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { beatOf, itemOf, reasonOf, value } from '../runs.ts';
import { approvedBy, greenFacts, itemLog, namesSince, shipPullRequest } from '../ship-fixtures.ts';
import { callerFor, heads, hostedOn, type Journey } from './cast.ts';

const reviewer = 'uw-reviewer[bot]';

const mergeKeys = [
  'connector',
  'harnessId',
  'itemId',
  'pullRequest',
  'expectedHead',
  'repository',
  'title',
  'overrideReason',
] as const;

async function approve(journey: Journey) {
  const { cast, itemId } = journey;
  return cast.world.kernel.gates.decide(callerFor(cast, cast.ian), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(cast.world, itemId),
  });
}

function named(events: readonly HarnessEvent[], name: string): readonly HarnessEvent[] {
  return events.filter((event) => event.name === name);
}

async function nothingDecidedOrMerged(journey: Journey): Promise<void> {
  const { world, harnessId } = journey.cast;
  const after = await itemLog(world, harnessId, journey.itemId);
  assert.deepEqual(after.decisions, []);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
}

async function refusedOver(
  journey: Journey,
  facts: PullRequestFacts,
  reasons: readonly string[],
): Promise<void> {
  const { world, harnessId } = journey.cast;
  world.adapters.githubFacts.given(facts);
  const before = await itemLog(world, harnessId, journey.itemId);
  const outcome = await approve(journey);
  const after = await itemLog(world, harnessId, journey.itemId);
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.reason, reasons[0]);
  assert.deepEqual(outcome.detail['reasons'], reasons);
  assert.deepEqual(namesSince(before, after), ['risk_derived', 'ship_refused']);
  assert.deepEqual(named(after.events, 'ship_refused').at(-1)?.evidence, {
    stage: 'ship',
    reasons,
  });
  await nothingDecidedOrMerged(journey);
}

async function refusedOnTheFacts(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world } = cast;
  const undeclared = { itemId, head: heads.second, reviews: [], declaration: null };
  await refusedOver(journey, greenFacts(world, undeclared), [
    'no_reviewer_approval',
    'risk_tier_undeclared',
  ]);
  const later = approvedBy(reviewer, 'anthropic', heads.pushed, 9100000301);
  const pushed = { itemId, head: heads.pushed, reviews: [later] };
  await refusedOver(journey, greenFacts(world, pushed), ['head_mismatch']);
}

async function repliedOnZulip(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world, harnessId, kim } = cast;
  const item = await itemOf(world, itemId);
  const before = await itemLog(world, harnessId, itemId);
  const reply = {
    harnessId,
    itemId,
    messageId: 7001,
    topic: item?.zulipTopic ?? '',
    personId: kim.personId,
    email: kim.email ?? '',
    text: 'approve',
  };
  value(await world.kernel.items.recordComment(callerFor(cast, simIngest()), reply));
  const after = await itemLog(world, harnessId, itemId);
  assert.deepEqual(namesSince(before, after), ['comment_recorded']);
  assert.equal(after.events.at(-1)?.evidence['personId'], kim.personId);
  await nothingDecidedOrMerged(journey);
  const parked = await itemOf(world, itemId);
  assert.deepEqual([parked?.stageKey, parked?.gateStatus], ['ship', 'parked']);
}

async function attemptAsAgent(journey: Journey, attempt: Caller): Promise<void> {
  const outcome = await journey.cast.world.kernel.gates.decide(attempt, {
    itemId: journey.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: heads.second,
  });
  assert.equal(reasonOf(outcome), 'gate_refused_to_agent');
}

async function refusedForAgents(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world, harnessId } = cast;
  const beat = await beatOf(hostedOn(cast, cast.builder, itemId));
  const before = await itemLog(world, harnessId, itemId);
  for (const attempt of [cast.laptop, beat]) await attemptAsAgent(journey, attempt);
  const after = await itemLog(world, harnessId, itemId);
  assert.deepEqual(namesSince(before, after), ['gate_refused_to_agent', 'gate_refused_to_agent']);
  const refusals = after.events.slice(before.events.length);
  assert.deepEqual(
    refusals.map((event) => event.actor),
    [cast.laptop.actor.identity, beat.actor.identity],
  );
  for (const event of refusals) {
    assert.deepEqual(event.evidence, { decision: 'approve', stage: 'ship' });
  }
  await nothingDecidedOrMerged(journey);
  const item = await itemOf(world, itemId);
  assert.deepEqual([item?.stageKey, item?.gateStatus], ['ship', 'parked']);
}

function mergeCallOf(journey: Journey): Readonly<Record<string, unknown>> {
  const calls = journey.cast.world.adapters.connectors.calls();
  assert.equal(calls.length, 1);
  const picked: ReadonlySet<string> = new Set(mergeKeys);
  return Object.fromEntries(Object.entries(calls[0] ?? {}).filter(([key]) => picked.has(key)));
}

async function approvedAndMerged(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world, harnessId } = cast;
  const review = approvedBy(reviewer, 'anthropic', heads.second, 9100000302);
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId, head: heads.second, reviews: [review] }),
  );
  const before = await itemLog(world, harnessId, itemId);
  const decided = value(await approve(journey));
  const after = await itemLog(world, harnessId, itemId);
  assert.equal(decided.advanced, true);
  assert.deepEqual([decided.item.stageKey, decided.item.gateStatus], ['validate', 'working']);
  assert.deepEqual(namesSince(before, after), [
    'risk_derived',
    'gate_approved',
    'connector_succeeded',
    'stage_advanced',
  ]);
  assert.equal(named(after.events, 'gate_approved').at(-1)?.actor, cast.ian.identity);
  const merged = named(after.events, 'connector_succeeded').at(-1)?.evidence;
  assert.deepEqual(merged, { connector: 'merge', detail: {} });
  const advanced = named(after.events, 'stage_advanced').at(-1)?.evidence;
  assert.deepEqual(advanced, { from: 'ship', to: 'validate' });
  assert.deepEqual(after.decisions, ['approve']);
  assert.deepEqual(mergeCallOf(journey), {
    connector: 'merge',
    harnessId,
    itemId,
    pullRequest: shipPullRequest,
    expectedHead: heads.second,
    repository: 'unfoldingWord/uw-platform',
    title: 'Show the board',
    overrideReason: null,
  });
}

export async function travelThroughShip(journey: Journey): Promise<void> {
  await repliedOnZulip(journey);
  await refusedOnTheFacts(journey);
  await refusedForAgents(journey);
  await approvedAndMerged(journey);
}
