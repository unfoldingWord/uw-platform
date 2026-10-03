import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type KernelOutcome, type PullRequestFacts } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

const head = standardChange.head;
const older = simSha('def456');

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
  return { world, harnessId: harness.id, itemId: parked.itemId, ian: admin, max };
}

function factsWith(scene: Scene, reviews: PullRequestFacts['reviews']): PullRequestFacts {
  return greenFacts(scene.world, { itemId: scene.itemId, head, reviews });
}

async function approveAs(
  scene: Scene,
  who: Principal,
  facts: PullRequestFacts,
): Promise<{ outcome: KernelOutcome<unknown>; names: readonly string[] }> {
  const { world, harnessId, itemId } = scene;
  world.adapters.githubFacts.given(facts);
  const before = await itemLog(world, harnessId, itemId);
  const outcome = await world.kernel.gates.decide(simCaller(world, who), {
    itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(world, itemId),
  });
  assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
  return { outcome, names: namesSince(before, await itemLog(world, harnessId, itemId)) };
}

async function refusedOver(scene: Scene, facts: PullRequestFacts): Promise<void> {
  const { outcome, names } = await approveAs(scene, scene.ian, facts);
  assert.equal(outcome.status === 'error' && outcome.reason, 'no_reviewer_approval');
  assert.deepEqual(names, ['risk_derived', 'ship_refused']);
  assert.deepEqual(scene.world.adapters.connectors.calls(), []);
}

async function agentNeverDecides(scene: Scene): Promise<void> {
  const agent = simAgent(scene.max, `${scene.max.personId}/builder`, { interactive: true });
  const good = factsWith(scene, [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000201)]);
  const { outcome, names } = await approveAs(scene, agent, good);
  assert.equal(outcome.status === 'error' && outcome.reason, 'gate_refused_to_agent');
  assert.deepEqual(names, ['gate_refused_to_agent']);
}

async function approvedOnTheHead(scene: Scene): Promise<void> {
  const facts = factsWith(scene, [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000202)]);
  const { outcome, names } = await approveAs(scene, scene.ian, facts);
  assert.equal(outcome.status, 'accepted');
  assert.deepEqual(names, [
    'risk_derived',
    'gate_approved',
    'connector_succeeded',
    'stage_advanced',
  ]);
  assert.equal(scene.world.adapters.connectors.calls().length, 1);
}

export const scenario = defineScenario({
  id: 'GH-5',
  title:
    'only a GitHub review by a Reviewer identity on the head counts as an approval at Ship: another identity and an older commit are refused no_reviewer_approval with nothing merged, an agent never decides, and the Reviewer on the head ships',
  run: async (simWorld) => {
    const scene = await parkedAtShip(simWorld);
    await refusedOver(
      scene,
      factsWith(scene, [approvedBy('octocat', 'anthropic', head, 9100000101)]),
    );
    const onOlder = approvedBy('uw-reviewer[bot]', 'anthropic', older, 9100000102);
    await refusedOver(scene, factsWith(scene, [onOlder]));
    await agentNeverDecides(scene);
    await approvedOnTheHead(scene);
    const { decisions } = await itemLog(simWorld, scene.harnessId, scene.itemId);
    assert.deepEqual(decisions, ['approve']);
    const connectorCalls = simWorld.adapters.connectors.calls().length;
    return { state: { decisions, connectorCalls } };
  },
});
