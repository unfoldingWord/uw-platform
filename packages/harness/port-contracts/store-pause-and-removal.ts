import { expect, it } from 'vitest';
import { identitySchema } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, itemOf, refusedBy, seedHarness, uid } from './store-gateway-fixtures.ts';

type RemovalSubject = () => { readonly store: Store };

export function describeHarnessPause(subject: RemovalSubject): void {
  it('DX-3 sets a harness paused and back', async () => {
    const seen = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x2500, 'gateway-pause');
      const pausedOf = async () => (await tx.harnesses.read.byId(uid(0x2500)))?.paused;
      await tx.harnesses.write.setPaused(uid(0x2500), true);
      const paused = await pausedOf();
      await tx.harnesses.write.setPaused(uid(0x2500), false);
      return [paused, await pausedOf()];
    });
    expect(seen).toEqual([true, false]);
  });
}

export function describeStageRemoval(subject: RemovalSubject): void {
  it('DX-3 removes a stage that holds no item', async () => {
    const keys = await subject().store.transaction(async (tx) => {
      const { review } = await seedHarness(tx, 0x2600, 'gateway-remove');
      await tx.harnessStages.write.remove(review.id);
      return (await tx.harnessStages.read.forHarness(uid(0x2600))).map((stage) => stage.key);
    });
    expect(keys).toEqual(['build', 'ship']);
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
      const { review } = await seedHarness(tx, 0x2800, 'gateway-remove-decided');
      const item = itemOf(0x2800, 1);
      await tx.harnessItems.write.insert(item, at);
      await tx.gateDecisions.write.insert({
        id: uid(0x2881),
        harnessId: uid(0x2800),
        itemId: item.itemId,
        stageId: review.id,
        actor: identitySchema.parse('human:ian'),
        decision: 'approve',
        reason: null,
        evidence: { findings: [], gateTarget: null },
        traceId: uid(0x2891),
        decidedAt: at,
      });
      await tx.harnessStages.write.remove(review.id);
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'gate_decisions_stage_fk' });
  });
}
