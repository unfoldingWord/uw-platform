import assert from 'node:assert/strict';
import {
  eventEvidenceSchemas,
  type ItemState,
  type Principal,
  type RiskDeclaration,
} from '@uw/contracts';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAdvance, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

const paths = ['packages/db/migrations/0009_x.sql'];
const declaration: RiskDeclaration = { riskTier: 'standard', riskDomains: [] };
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };

async function atBuild(
  world: World,
  n: number,
): Promise<{
  readonly harnessId: string;
  readonly itemId: string;
  readonly owner: Principal;
}> {
  const { harness } = await createSimHarness(world, software, { key: `risk-${n}` });
  const owner = await simPerson(world, n, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const { itemId } = valueOf(
    await world.kernel.items.enqueue(simCaller(world, owner), {
      harnessId: harness.id,
      title: 'Add a migration',
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  const editor = simCaller(world, owner);
  valueOf(await world.kernel.items.claim(editor, { itemId, delegationId: null }));
  valueOf(
    await world.kernel.items.submit(editor, { itemId, to: null, evidence: {}, change: null }),
  );
  const worker = simAgent(owner, `${owner.personId}/builder`, { interactive: true });
  const item = await simAdvance(world, {
    harnessId: harness.id,
    itemId,
    worker,
    through: ['scope', 'plan'],
  });
  assert.equal(item.stageKey, 'build');
  return { harnessId: harness.id, itemId, owner };
}

type Scene = { readonly harnessId: string; readonly itemId: string; readonly owner: Principal };

type Change = {
  readonly head: string;
  readonly paths: readonly string[];
  readonly declaration: RiskDeclaration | null;
};

async function submitHeld(
  world: World,
  scene: { readonly itemId: string; readonly owner: Principal },
  change: Change | null,
): Promise<KernelOutcome<{ readonly item: ItemState }>> {
  return world.kernel.items.submit(simCaller(world, scene.owner), {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: change === null ? null : { pullRequest, ...change },
  });
}

async function submitWith(
  world: World,
  scene: { readonly itemId: string; readonly owner: Principal },
  change: Change | null,
): Promise<ItemState> {
  const worker = simCaller(world, scene.owner);
  valueOf(await world.kernel.items.claim(worker, { itemId: scene.itemId, delegationId: null }));
  return valueOf(await submitHeld(world, scene, change)).item;
}

async function derivedEvents(world: World, harnessId: string, itemId: string) {
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harnessId, itemId),
  );
  events.forEach((event, index) => {
    if (event.name === 'risk_derived') {
      assert.equal(events[index + 1]?.name, 'submitted_to_gate');
    }
  });
  return events
    .filter((event) => event.name === 'risk_derived')
    .map((event) => eventEvidenceSchemas.risk_derived.parse(event.evidence));
}

const benign = ['apps/uw-app/board.tsx'];
const low: RiskDeclaration = { riskTier: 'low', riskDomains: [] };

function assertHigh(item: ItemState): void {
  assert.equal(item.riskTier, 'high');
  assert.deepEqual(item.riskDomains, ['migration']);
}

async function ratchetOnItem(world: World): Promise<{
  readonly scene: Scene;
  readonly last: ItemState;
}> {
  const scene = await atBuild(world, 2);
  assertHigh(await submitWith(world, scene, { head: 'abc123', paths, declaration }));
  const otherHead = { head: 'def456', paths: benign, declaration: null };
  assertHigh(await submitWith(world, scene, otherHead));
  const last = await submitWith(world, scene, { ...otherHead, head: ' ABC123 ', declaration: low });
  assertHigh(last);
  assert.equal(last.expectedHead, 'abc123');
  return { scene, last };
}

async function undeclaredOnItem(world: World): Promise<void> {
  const other = await atBuild(world, 3);
  const worker = simCaller(world, other.owner);
  valueOf(await world.kernel.items.claim(worker, { itemId: other.itemId, delegationId: null }));
  const spaced = await submitHeld(world, other, {
    head: 'abc 123',
    paths: benign,
    declaration: null,
  });
  assert.equal(spaced.status === 'error' && spaced.reason, 'malformed_command');
  const undeclared = valueOf(
    await submitHeld(world, other, { head: 'def456', paths: benign, declaration: null }),
  ).item;
  assert.equal(undeclared.riskTier, null);
  assert.deepEqual(undeclared.riskDomains, []);
  const noChange = await submitWith(world, other, null);
  assert.equal(noChange.riskTier, null);
  assert.deepEqual(noChange.riskDomains, []);
  const derived = await derivedEvents(world, other.harnessId, other.itemId);
  assert.equal(derived.length, 1);
  assert.equal(derived[0]?.refusal, 'risk_tier_undeclared');
  assert.equal(derived[0]?.declaration, null);
}

export const scenario = defineScenario({
  id: 'KN-17',
  title:
    'risk is floored high by protected paths, raised and never lowered by the declaration, and an undeclared tier is recorded for the ship rule',
  run: async (world) => {
    const { scene, last } = await ratchetOnItem(world);
    await undeclaredOnItem(world);
    const derived = await derivedEvents(world, scene.harnessId, scene.itemId);
    assert.equal(derived.length, 3);
    assert.deepEqual(derived[0], {
      paths,
      declaration,
      floorDomains: ['migration'],
      riskTier: 'high',
      riskDomains: ['migration'],
      refusal: null,
    });
    assert.deepEqual(derived[1]?.floorDomains, ['migration']);
    assert.equal(derived[1]?.refusal, 'risk_tier_undeclared');
    assert.equal(derived[1]?.riskTier, 'high');
    assert.deepEqual(derived[2]?.floorDomains, ['migration']);
    return { state: { riskTier: last.riskTier, riskDomains: last.riskDomains } };
  },
});
