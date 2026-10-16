import { expect, it } from 'vitest';
import { identitySchema } from '@uw/contracts';
import type { Store, StoreTransaction } from '../ports.ts';
import { at, itemOf, refusedBy, seedHarness, uid, type Stages } from './store-gateway-fixtures.ts';

type RemovalSubject = () => { readonly store: Store };

export function describeHarnessPause(subject: RemovalSubject): void {
  it('DX-3 sets a harness paused and back', async () => {
    const seen = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x2500, 'gateway-pause');
      const pausedOf = async () => (await tx.harnesses.read.byId(uid(0x2500)))?.paused;
      const set = await tx.harnesses.write.setPaused(uid(0x2500), true);
      const paused = await pausedOf();
      const unset = await tx.harnesses.write.setPaused(uid(0x2500), false);
      return [set, paused, unset, await pausedOf()];
    });
    expect(seen).toEqual([true, true, true, false]);
  });

  it('DX-3 sets hosted Builder on and back, and reports no harness for an id that names none', async () => {
    const seen = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x2510, 'gateway-hosted-builder');
      const enabledOf = async () =>
        (await tx.harnesses.read.byId(uid(0x2510)))?.hostedBuilderEnabled;
      const before = await enabledOf();
      const set = await tx.harnesses.write.setHostedBuilder(uid(0x2510), true);
      const enabled = await enabledOf();
      const unset = await tx.harnesses.write.setHostedBuilder(uid(0x2510), false);
      const missing = await tx.harnesses.write.setHostedBuilder(uid(0x25fd), true);
      return [before, set, enabled, unset, await enabledOf(), missing];
    });
    expect(seen).toEqual([false, true, true, true, false, false]);
  });

  it('DX-3 reports that no harness was paused when the id names none', async () => {
    const found = await subject().store.transaction((tx) =>
      tx.harnesses.write.setPaused(uid(0x25fe), true),
    );
    expect(found).toBe(false);
  });
}

export function describeStageRemoval(subject: RemovalSubject): void {
  it('DX-3 removes a stage that holds no item', async () => {
    const keys = await subject().store.transaction(async (tx) => {
      const { review } = await seedHarness(tx, 0x2600, 'gateway-remove');
      const removed = await tx.harnessStages.write.remove(review.id);
      const left = await tx.harnessStages.read.forHarness(uid(0x2600));
      return { removed, keys: left.map((stage) => stage.key) };
    });
    expect(keys).toEqual({ removed: true, keys: ['build', 'ship'] });
  });

  it('DX-3 reports that no stage was removed when the id names none', async () => {
    const removed = await subject().store.transaction((tx) =>
      tx.harnessStages.write.remove(uid(0x26fe)),
    );
    expect(removed).toBe(false);
  });

  it('DX-3 refuses to remove a stage that holds an item, naming harness_items_stage_fk', async () => {
    const outcome = await refusedBy(async (tx) => {
      const { build } = await seedHarness(tx, 0x2700, 'gateway-remove-held');
      await tx.harnessItems.write.insert(itemOf(0x2700, 1), at);
      await tx.harnessStages.write.remove(build.id);
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'harness_items_stage_fk' });
  });

  it('DX-3 refuses to remove a stage with gate decisions, naming gate_decisions_stage_fk', async () => {
    const outcome = await refusedBy(async (tx) => {
      const { review } = await seedDecision(tx, 0x2800, 'gateway-remove-decided');
      await tx.harnessStages.write.remove(review.id);
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'gate_decisions_stage_fk' });
  });

  it('DX-3 answers whether a stage has any gate decision', async () => {
    const seen = await subject().store.transaction(async (tx) => {
      const { build, review } = await seedDecision(tx, 0x2900, 'gateway-stage-history');
      return [
        await tx.gateDecisions.read.anyForStage(review.id),
        await tx.gateDecisions.read.anyForStage(build.id),
        await tx.gateDecisions.read.anyForStage(uid(0x29fe)),
      ];
    });
    expect(seen).toEqual([true, false, false]);
  });
}

async function seedDecision(tx: StoreTransaction, base: number, key: string): Promise<Stages> {
  const stages = await seedHarness(tx, base, key);
  const item = itemOf(base, 1);
  await tx.harnessItems.write.insert(item, at);
  await tx.gateDecisions.write.insert({
    id: uid(base + 0x81),
    harnessId: uid(base),
    itemId: item.itemId,
    stageId: stages.review.id,
    actor: identitySchema.parse('human:ian'),
    agentActor: null,
    delegationId: null,
    decision: 'approve',
    reason: null,
    evidence: { findings: [], gateTarget: null },
    traceId: uid(base + 0x91),
    decidedAt: at,
  });
  return stages;
}
