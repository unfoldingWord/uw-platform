import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type ReviewFact } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  shipPullRequest,
  simParkedAtShip,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly kim: Principal;
};

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

async function parkedHighAtShip(world: World): Promise<Scene> {
  const { harness, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 2, [{ role: 'editor', ...area }]);
  const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
  const parked = await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: max,
    title: 'Add a migration',
    change: {
      pullRequest: shipPullRequest,
      head: 'abc123',
      paths: ['packages/db/migrations/0009_x.sql'],
      declaration: { riskTier: 'standard', riskDomains: [] },
    },
  });
  assert.equal(parked.riskTier, 'high');
  assert.deepEqual(parked.riskDomains, ['migration']);
  return { world, harnessId: harness.id, itemId: parked.itemId, ian: admin, kim };
}

async function approveOver(scene: Scene, approver: Principal, reviews: readonly ReviewFact[]) {
  const { world } = scene;
  world.adapters.githubFacts.given(greenFacts(world, 'abc123', reviews));
  const outcome = await world.kernel.gates.decide(simCaller(world, approver), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
  assert.deepEqual((await readWorldLog(world.adapters.store)).drift, []);
  return outcome;
}

async function refusedWith(
  scene: Scene,
  approver: Principal,
  reviews: readonly ReviewFact[],
  reason: string,
): Promise<void> {
  const outcome = await approveOver(scene, approver, reviews);
  assert.equal(outcome.status === 'error' && outcome.reason, reason);
  const { events, decisions } = await itemLog(scene.world, scene.harnessId, scene.itemId);
  assert.deepEqual(events.at(-1)?.evidence, { stage: 'ship', reasons: [reason] });
  assert.deepEqual(decisions, []);
}

const anthropic = approvedBy('uw-reviewer', 'anthropic', 'abc123');
const secondAnthropic = approvedBy('uw-reviewer-two', 'anthropic', 'abc123');
const openai = approvedBy('uw-reviewer-two', 'openai', 'abc123');

export const scenario = defineScenario({
  id: 'KN-12',
  title:
    'a high-tier change needs two reviewers with distinct providers on the head and an approver holding every grant its domains name',
  run: async (world) => {
    const scene = await parkedHighAtShip(world);
    await refusedWith(scene, scene.ian, [anthropic], 'reviewer_count_below_tier');
    await refusedWith(
      scene,
      scene.ian,
      [anthropic, secondAnthropic],
      'reviewer_providers_not_distinct',
    );
    await refusedWith(scene, scene.kim, [anthropic, openai], 'approver_lacks_domain_grant');
    const approved = await approveOver(scene, scene.ian, [anthropic, openai]);
    if (approved.status !== 'accepted') throw new Error(`refused: ${approved.reason}`);
    assert.equal(approved.value.advanced, true);
    assert.equal(approved.value.item.stageKey, 'validate');
    const { decisions } = await itemLog(world, scene.harnessId, scene.itemId);
    assert.deepEqual(decisions, ['approve']);
    assert.equal(world.adapters.connectors.calls().length, 1);
    return { state: { decisions, stageKey: approved.value.item.stageKey } };
  },
});
