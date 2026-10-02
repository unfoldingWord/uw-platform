import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type PullRequestFacts } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
};

async function parkedAtShip(world: World): Promise<Scene> {
  const { harness, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const parked = await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: max,
    title: 'Show the board',
    change: standardChange,
  });
  return { world, harnessId: harness.id, itemId: parked.itemId, ian: admin };
}

async function refusedOver(scene: Scene, facts: PullRequestFacts) {
  const { world, harnessId, itemId } = scene;
  world.adapters.githubFacts.given(facts);
  const before = await itemLog(world, harnessId, itemId);
  const outcome = await world.kernel.gates.decide(simCaller(world, scene.ian), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
  assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
  if (outcome.status !== 'error') throw new Error('the approve was accepted');
  const after = await itemLog(world, harnessId, itemId);
  assert.deepEqual(namesSince(before, after), ['ship_refused']);
  assert.deepEqual(after.decisions, []);
  assert.deepEqual(world.adapters.connectors.calls(), []);
  const item = await world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  assert.equal(item?.stageKey, 'ship');
  assert.equal(item?.gateStatus, 'parked');
  return { outcome, evidence: after.events.at(-1)?.evidence };
}

async function refusesAnotherHead(scene: Scene): Promise<void> {
  const facts = greenFacts(scene.world, 'def456', [
    approvedBy('uw-reviewer', 'anthropic', 'def456'),
  ]);
  const { outcome, evidence } = await refusedOver(scene, facts);
  assert.equal(outcome.reason, 'head_mismatch');
  assert.deepEqual(outcome.detail['reasons'], ['head_mismatch']);
  assert.deepEqual(evidence, { stage: 'ship', reasons: ['head_mismatch'] });
}

async function refusesADraftWithAFailingJob(scene: Scene): Promise<void> {
  const green = greenFacts(scene.world, 'abc123', [
    approvedBy('uw-reviewer', 'anthropic', 'abc123'),
  ]);
  const facts: PullRequestFacts = {
    ...green,
    draft: true,
    checks: green.checks.map((check) =>
      check.name === 'test' ? { ...check, conclusion: 'failure' } : check,
    ),
  };
  const { outcome, evidence } = await refusedOver(scene, facts);
  assert.equal(outcome.reason, 'pr_is_draft');
  assert.deepEqual(outcome.detail['reasons'], ['pr_is_draft', 'checks_not_green']);
  assert.deepEqual(evidence, { stage: 'ship', reasons: ['pr_is_draft', 'checks_not_green'] });
}

export const scenario = defineScenario({
  id: 'KN-11',
  title:
    'the ship rule refuses on the GitHub facts read at decision time: another head is head_mismatch, a draft with a failing job reports both reasons in order, and nothing is decided or merged',
  run: async (world) => {
    const scene = await parkedAtShip(world);
    await refusesAnotherHead(scene);
    await refusesADraftWithAFailingJob(scene);
    const { decisions } = await itemLog(world, scene.harnessId, scene.itemId);
    return { state: { decisions, merges: world.adapters.connectors.calls().length } };
  },
});
