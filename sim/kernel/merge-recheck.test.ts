import type { ItemState, Principal, Stage } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { exitAfterDecision, type PendingExit } from '@uw/harness/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  secondChange,
  simParkedAtShip,
  simPatchId,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harness: Awaited<ReturnType<typeof createSimHarness>>['harness'];
  readonly stages: readonly Stage[];
  readonly item: ItemState;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin, stages } = await createSimHarness(world, software);
    const item = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change: standardChange,
    });
    await work({ world, admin, harness, stages, item });
  } finally {
    await world.close();
  }
}

function stageOf(scene: Scene, key: string): Stage {
  const stage = scene.stages.find((entry) => entry.key === key);
  if (stage === undefined) throw new Error(`no stage ${key}`);
  return stage;
}

function pendingFor(scene: Scene): PendingExit {
  const { world } = scene;
  return {
    item: scene.item,
    stage: stageOf(scene, 'ship'),
    connector: 'merge',
    next: stageOf(scene, 'validate'),
    decisionId: world.adapters.ids.next(),
    overrideReason: null,
    repository: 'unfoldingWord/uw-platform',
    expectedBase: null,
    evaluatedHead: scene.item.expectedHead,
    delegated: null,
    harness: scene.harness,
    approver: scene.admin,
    override: false,
    context: {
      actor: scene.admin.identity,
      at: world.adapters.clock.now(),
      traceId: world.adapters.ids.next(),
      requestId: null,
      ids: world.adapters.ids,
    },
  };
}

async function lastEvent(scene: Scene) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.item.harnessId, scene.item.itemId),
  );
  return events.at(-1);
}

async function neighbourMerged(scene: Scene): Promise<void> {
  const { world, admin } = scene;
  const other = await simParkedAtShip(world, {
    harnessId: scene.harness.id,
    editor: admin,
    title: 'Show the flow',
    change: secondChange,
  });
  const neighbour = [approvedBy('uw-reviewer[bot]', 'deepinfra', secondChange.head, 9300000002)];
  world.adapters.githubFacts.given(
    greenFacts(world, {
      itemId: other.itemId,
      head: secondChange.head,
      ref: secondChange.pullRequest,
      reviews: neighbour,
    }),
  );
  const input = {
    itemId: other.itemId,
    decision: 'approve' as const,
    reason: null,
    findings: [],
    seenHead: secondChange.head,
  };
  expect(value(await world.kernel.gates.decide(simCaller(world, admin), input)).advanced).toBe(
    true,
  );
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: scene.item.itemId, head: standardChange.head, reviews: [] }),
  );
  const exited = await exitAfterDecision(world.adapters, pendingFor(scene));
  expect(exited.advanced).toBe(false);
  expect(calledItems(world)).toEqual([other.itemId]);
  expect(await lastEvent(scene)).toMatchObject({
    name: 'connector_refused',
    evidence: { connector: 'merge', reason: 'ship_rule_refused: no_reviewer_approval' },
  });
}

async function headMoved(scene: Scene): Promise<void> {
  const { world } = scene;
  const moved = simSha('c0de');
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: scene.item.itemId, head: moved, reviews }),
  );
  expect((await exitAfterDecision(world.adapters, pendingFor(scene))).advanced).toBe(false);
  expect(world.adapters.connectors.calls()).toEqual([]);
  expect((await lastEvent(scene))?.evidence['reason']).toMatch(/^ship_rule_refused: head_mismatch/);
}

async function evaluatedHeadMerged(scene: Scene): Promise<void> {
  const { world } = scene;
  const merged = simSha('b4e2');
  const patchId = simPatchId('9a7c');
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
  const commits = [
    { sha: standardChange.head, merge: false, skipCi: false, closes: [] },
    { sha: merged, merge: true, skipCi: false, closes: [] },
  ];
  const facts = greenFacts(world, { itemId: scene.item.itemId, head: merged, reviews });
  const patchIds = { [standardChange.head]: patchId, [merged]: patchId };
  world.adapters.githubFacts.given({
    ...facts,
    comparison: comparedAt(merged, { commits, patchId, patchIds }),
  });
  await exitAfterDecision(world.adapters, pendingFor(scene));
  expect(calledHeads(world)).toEqual([merged]);
  expect(await lastEvent(scene)).toMatchObject({ name: 'connector_succeeded' });
}

async function frozenAfterDecision(scene: Scene): Promise<void> {
  const { world, admin } = scene;
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', standardChange.head, 9300000001)];
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: scene.item.itemId, head: standardChange.head, reviews }),
  );
  const freeze = { harnessId: scene.harness.id, frozen: true, allow: [] };
  value(await world.kernel.stages.setFreeze(simCaller(world, admin), freeze));
  expect((await exitAfterDecision(world.adapters, pendingFor(scene))).advanced).toBe(false);
  expect(world.adapters.connectors.calls()).toEqual([]);
  expect((await lastEvent(scene))?.evidence['reason']).toMatch(
    /^ship_rule_refused: .*harness_frozen/,
  );
}

function calledItems(world: World): readonly string[] {
  return world.adapters.connectors.calls().map((call) => call.itemId);
}

function calledHeads(world: World): readonly (string | null)[] {
  return world.adapters.connectors.calls().map((call) => call.expectedHead);
}

describe('SR-3 the merge connector runs the ship rule in-process', () => {
  it('SR-3 never reads a verdict from another item: an approved, merged neighbour does not merge this one', () =>
    inScene(neighbourMerged));

  it('SR-3 refuses the merge when the head moved after the decision, and calls no connector', () =>
    inScene(headMoved));

  it('SR-3 hands the connector the head the rule evaluated, not the one the item expected', () =>
    inScene(evaluatedHeadMerged));

  it('SR-3 re-reads the harness at the merge: a freeze set after the decision stops it, and no connector is called', () =>
    inScene(frozenAfterDecision));
});
