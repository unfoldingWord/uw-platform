import assert from 'node:assert/strict';
import type { GateDecision, Principal } from '@uw/contracts';
import { software } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { defineScenario } from '../scenario.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import type { World } from '../world.ts';

type Lane = {
  readonly world: World;
  readonly harnessId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

const reason = 'Hotfix for the outage on 2026-10-01';
const hotfix = { repo: 'unfoldingWord/uw-platform', number: 43 };
const migration = { repo: 'unfoldingWord/uw-platform', number: 44 };
const migrationPaths = ['packages/db/migrations/0009_x.sql'];

async function decideAs(lane: Lane, itemId: string, decision: GateDecision, why: string | null) {
  const outcome = await lane.world.kernel.gates.decide(simCaller(lane.world, lane.ian), {
    itemId,
    decision,
    reason: why,
    findings: [],
  });
  assert.deepEqual((await readWorldLog(lane.world.adapters.store)).drift, []);
  return outcome;
}

async function overridesTheMissingReview(lane: Lane): Promise<readonly GateDecision[]> {
  const { world, harnessId } = lane;
  const parked = await simParkedAtShip(world, {
    harnessId,
    editor: lane.max,
    title: 'Fix the outage',
    change: { ...standardChange, pullRequest: hotfix },
  });
  const { head } = standardChange;
  const facts = { itemId: parked.itemId, head, reviews: [], ref: hotfix };
  world.adapters.githubFacts.given(greenFacts(world, facts));
  const approved = await decideAs(lane, parked.itemId, 'approve', null);
  assert.equal(approved.status === 'error' && approved.reason, 'no_reviewer_approval');
  const blank = await decideAs(lane, parked.itemId, 'override', '   ');
  assert.equal(blank.status === 'error' && blank.reason, 'reason_required');
  const overridden = await decideAs(lane, parked.itemId, 'override', `  ${reason}  `);
  if (overridden.status !== 'accepted') throw new Error(`refused: ${overridden.reason}`);
  assert.equal(overridden.value.advanced, true);
  assert.equal(overridden.value.item.stageKey, 'validate');
  const rows = await world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(parked.itemId),
  );
  assert.deepEqual(
    rows.map((row) => [row.decision, row.reason]),
    [['override', reason]],
  );
  const { events, decisions } = await itemLog(world, harnessId, parked.itemId);
  const marked = events.find((event) => event.name === 'gate_overridden');
  assert.deepEqual(marked?.evidence, {
    decisionId: overridden.value.decisionId,
    stage: 'ship',
    reason,
  });
  const [call] = world.adapters.connectors.calls();
  assert.deepEqual([call?.title, call?.overrideReason], ['Fix the outage', reason]);
  return decisions;
}

async function overrideKeepsTheTierRule(lane: Lane): Promise<void> {
  const { world, harnessId } = lane;
  const parked = await simParkedAtShip(world, {
    harnessId,
    editor: lane.max,
    title: 'Add a migration',
    change: {
      ...standardChange,
      pullRequest: migration,
      paths: migrationPaths,
    },
  });
  assert.equal(parked.riskTier, 'high');
  const { head } = standardChange;
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
  const facts = { itemId: parked.itemId, head, reviews, ref: migration, paths: migrationPaths };
  world.adapters.githubFacts.given(greenFacts(world, facts));
  const overridden = await decideAs(lane, parked.itemId, 'override', reason);
  assert.equal(overridden.status === 'error' && overridden.reason, 'reviewer_count_below_tier');
  const { decisions } = await itemLog(world, harnessId, parked.itemId);
  assert.deepEqual(decisions, []);
  assert.equal(world.adapters.connectors.calls().length, 1);
}

export const scenario = defineScenario({
  id: 'KN-13',
  title:
    'override at Ship needs a non-empty reason, advances past a missing review with the reason recorded and carried into the merge message, and never past the tier rule',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const lane: Lane = { world, harnessId: harness.id, ian: admin, max };
    const decisions = await overridesTheMissingReview(lane);
    await overrideKeepsTheTierRule(lane);
    return { state: { decisions, merges: world.adapters.connectors.calls().length } };
  },
});
