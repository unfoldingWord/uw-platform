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

async function atBuild(world: World): Promise<{
  readonly harnessId: string;
  readonly itemId: string;
  readonly owner: Principal;
}> {
  const { harness } = await createSimHarness(world, software);
  const owner = await simPerson(world, 2, [
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

async function submitAtBuild(
  world: World,
  scene: { readonly itemId: string; readonly owner: Principal },
  change: { readonly declaration: RiskDeclaration | null },
): Promise<ItemState> {
  const worker = simCaller(
    world,
    simAgent(scene.owner, `${scene.owner.personId}/builder`, { interactive: true }),
  );
  valueOf(await world.kernel.items.claim(worker, { itemId: scene.itemId, delegationId: null }));
  const submitted = await world.kernel.items.submit(worker, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: { pullRequest, head: 'abc123', paths, declaration: change.declaration },
  });
  return valueOf(submitted).item;
}

export const scenario = defineScenario({
  id: 'KN-17',
  title:
    'risk is floored high by protected paths, raised and never lowered by the declaration, and an undeclared tier is recorded for the ship rule',
  run: async (world) => {
    const scene = await atBuild(world);
    const declared = await submitAtBuild(world, scene, { declaration });
    assert.equal(declared.riskTier, 'high');
    assert.deepEqual(declared.riskDomains, ['migration']);
    const undeclared = await submitAtBuild(world, scene, { declaration: null });
    assert.equal(undeclared.riskTier, null);
    assert.deepEqual(undeclared.riskDomains, ['migration']);
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, scene.itemId),
    );
    const derived = events
      .filter((event) => event.name === 'risk_derived')
      .map((event) => eventEvidenceSchemas.risk_derived.parse(event.evidence));
    assert.equal(derived.length, 2);
    assert.deepEqual(derived[0], {
      paths,
      declaration,
      floorDomains: ['migration'],
      riskTier: 'high',
      riskDomains: ['migration'],
      refusal: null,
    });
    assert.equal(derived[1]?.refusal, 'risk_tier_undeclared');
    assert.equal(derived[1]?.declaration, null);
    return { state: { riskTier: declared.riskTier, riskDomains: declared.riskDomains } };
  },
});
